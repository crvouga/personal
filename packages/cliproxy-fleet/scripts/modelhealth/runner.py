"""Run liveness, readiness and end-to-end levels; derive independent per-model health."""

import concurrent.futures
import datetime
import json
import os
import pathlib
import random
import time

from . import checks, protocol
from .redact import Redactor
from .transport import Client, TransportError

SEVERITY_ORDER = {"critical": 0, "major": 1, "minor": 2}
SCHEMA = "cliproxy-model-health/1"


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1))))]


def _level(status, category=None, details=None, **extra):
    return dict({"status": status, "category": category, "details": details or []}, **extra)


# ------------------------------------------------------------------- levels

def liveness(base_url, redact, timeout):
    """Unauthenticated and free: the API rejects anonymous callers and the dashboard serves."""
    origin = base_url.rstrip("/")
    origin = origin[: -len("/v1")] if origin.endswith("/v1") else origin
    api, dashboard = Client(base_url, None, redact, timeout), Client(origin, None, redact, timeout)
    result = _level("healthy", probes={})
    try:
        response = api.request("GET", "/models", authenticated=False, kind="liveness")
        result["probes"]["api_rejects_anonymous"] = {"http_status": response.status, "latency_ms": round(response.elapsed * 1000)}
        if response.status == 200:
            result.update(_level("unhealthy", "auth", ["anonymous model listing was accepted"]))
        elif response.status != 401:
            result.update(_level("unhealthy", checks.http_category(response.status), ["unexpected HTTP %d" % response.status]))
        page = dashboard.request("GET", "/management.html", authenticated=False, kind="liveness")
        result["probes"]["dashboard"] = {"http_status": page.status, "latency_ms": round(page.elapsed * 1000)}
        if page.status != 200 and result["status"] == "healthy":
            result.update(_level("unhealthy", checks.http_category(page.status), ["dashboard returned HTTP %d" % page.status]))
    except TransportError as error:
        result.update(_level("unhealthy", error.category, [error.detail]))
    return result


def readiness(config, base_url, key, redact, timeout, retries, backoff):
    """Authenticated and free: the key works, /v1/models is valid, every configured alias is served."""
    if not key:
        return _level("unknown", "credentials", ["no client API key available"]), set()
    client = Client(base_url, key, redact, timeout)
    response = None
    for attempt in range(1 + retries):  # read-only listing: the one place a transport retry is safe
        try:
            response = client.request("GET", "/models", kind="readiness")
            break
        except TransportError as error:
            if attempt == retries:
                return _level("unhealthy", error.category, [error.detail]), set()
            time.sleep(backoff)
    if response.status != 200:
        return _level("unhealthy", checks.http_category(response.status),
                      ["GET /models returned HTTP %d" % response.status], http_status=response.status), set()
    body = response.json()
    problems = protocol.models_list_violations(body)
    if problems:
        return _level("unhealthy", "protocol", problems), set()
    served = {item["id"] for item in body["data"]}
    configured = {m["alias"] for m in config.models}
    missing = sorted(configured - served)
    return (
        _level("unhealthy" if missing else "healthy", "alias_missing" if missing else None,
               ["alias not served: " + alias for alias in missing],
               latency_ms=round(response.elapsed * 1000), served_models=len(served),
               discovered_unconfigured=sorted(served - configured)),
        served,
    )


# ------------------------------------------------------------------- models

def _capability_rows(config, model, results, selected, alias_known, alias_present, aborted):
    """Per-capability truth table: declared state versus what was actually observed."""
    by_id = {r["capability"]: r for r in results}
    rows = {}
    for case in config.cases:
        declared, reason = config.state(model, case.capability)
        row = {"declared": declared, "result": "untested", "reason": None, "severity": case.severity}
        result = by_id.get(case.capability)
        if declared == "unsupported":
            row.update(result="unsupported", reason=reason)
        elif result and result["status"] == "pass":
            row["result"] = "pass"
        elif result and result["status"] == "fail":
            if declared == "optional" and result["category"] in ("assertion", "protocol", "request_rejected"):
                row.update(result="observed_unsupported", reason="; ".join(result["details"])[:200])
            else:
                row.update(result="fail", reason=result["category"])
        elif result:
            row["reason"] = result["category"]
        elif not alias_known:
            row["reason"] = "readiness_not_passed"
        elif not alias_present:
            row["reason"] = "alias_missing"
        elif case.capability not in selected:
            row["reason"] = "not_in_profile"
        else:
            row["reason"] = "aborted" if aborted else "not_run"
        rows[case.capability] = row
    return rows


def _ratio(numerator, denominator):
    return round(numerator / denominator, 4) if denominator else None


def _metrics(events, results, observed_models):
    inference = [e for e in events if not e.get("probe")]
    infra = [e for e in events if e["category"] in checks.INFRA_CATEGORIES]
    streams = [e for e in inference if e["stream"] and not e["cancelled"]]
    tools = [e for e in inference if e["tool"]]
    totals = [round(e["total"] * 1000) for e in inference if e["total"] is not None and e["category"] is None]
    ttfts = [round(e["ttft"] * 1000) for e in streams if e["ttft"] is not None]
    categories = {}
    for result in results:
        if result["status"] == "fail":
            categories[result["category"]] = categories.get(result["category"], 0) + 1
    executed = [r for r in results if r["status"] in ("pass", "fail")]
    return {
        "requests": len(events),
        "availability": _ratio(len(events) - len(infra), len(events)),
        "success_rate": _ratio(sum(r["status"] == "pass" for r in executed), len(executed)),
        "ttft_ms": {"p50": percentile(ttfts, 0.5), "max": max(ttfts) if ttfts else None, "samples": len(ttfts)},
        "latency_ms": {"p50": percentile(totals, 0.5), "p95": percentile(totals, 0.95), "samples": len(totals)},
        "streaming_completion_rate": _ratio(sum(e["completed"] for e in streams), len(streams)),
        "tool_call_success_rate": _ratio(sum(e["ok"] for e in tools), len(tools)),
        "error_categories": categories,
        "upstream_failures": sum(e["category"] in ("upstream", "rate_limit", "timeout") for e in events),
        "resolved_models": sorted(observed_models),
        "routing": {"evidence": "none", "note": "Account routing is not observable from outside the proxy; see simulations."},
    }


def derive_status(config, rows, results, metrics, alias_known, alias_present, scope_e2e):
    """Return (status, reasons). Unknown is never upgraded to healthy."""
    policy = config.raw["health"]
    if not alias_known:
        return "unknown", ["readiness did not pass; the alias could not be confirmed"]
    if not alias_present:
        return "unhealthy", ["alias not served by /v1/models"]
    if not scope_e2e:
        return "unknown", ["alias is served, but inference was not exercised at this scope"]
    executed = [r for r in results if r["status"] in ("pass", "fail")]
    if not executed:
        return "unknown", ["no inference check completed"]
    failing = [r for r in executed if rows[r["capability"]]["result"] == "fail"]
    required = [r for r in executed if rows[r["capability"]]["declared"] == "required"]
    required_failing = [r for r in failing if rows[r["capability"]]["declared"] == "required"]
    critical = [r for r in required_failing if r["severity"] == "critical"]
    if critical:
        return "unhealthy", ["critical capability failing: " + critical[0]["capability"]]
    if required and len(required_failing) / len(required) >= policy["unhealthy_if_failed_ratio"]:
        return "unhealthy", ["%d of %d exercised required capabilities fail" % (len(required_failing), len(required))]
    reasons = []
    if failing:
        reasons.append("failing: " + ", ".join(sorted(r["capability"] for r in failing)))
    p50, p95 = metrics["ttft_ms"]["p50"], metrics["latency_ms"]["p95"]
    if p50 is not None and p50 > policy["latency_ms"]["ttft_p50_warn"]:
        reasons.append("time to first token p50 %dms exceeds policy" % p50)
    if p95 is not None and p95 > policy["latency_ms"]["total_p95_warn"]:
        reasons.append("latency p95 %dms exceeds policy" % p95)
    if policy.get("alias_consistency") and len(metrics["resolved_models"]) > 1:
        reasons.append("alias resolved to multiple model ids: " + ", ".join(metrics["resolved_models"]))
    return ("degraded" if reasons else "healthy"), reasons


def run_model(config, model, cases, make_client, budget, seed, redact, timeouts, alias_known, alias_present, scope_e2e):
    """Test one model in isolation; any failure here is confined to this model."""
    ctx = checks.Context(config, model, make_client, budget, random.Random("%s:%s" % (seed, model["alias"])), redact, timeouts)
    results, consecutive, aborted = [], 0, None
    if scope_e2e and alias_known and alias_present:
        for case in sorted(cases, key=lambda c: SEVERITY_ORDER[c.severity]):
            declared, _reason = config.state(model, case.capability)
            if declared == "unsupported" or aborted:
                continue
            result = checks.execute(ctx, case)
            result["declared"] = declared
            results.append(result)
            if result["status"] == "pass":
                consecutive = 0
            elif result["status"] == "fail":
                consecutive += 1
                if result["category"] == "rate_limit":
                    aborted = "rate limited; stopped to avoid hammering the account"
                elif consecutive >= config.raw["health"]["abort_model_after_consecutive_failures"]:
                    aborted = "%d consecutive failures" % consecutive
    rows = _capability_rows(config, model, results, {c.capability for c in cases}, alias_known, alias_present, aborted)
    metrics = _metrics(ctx.events, results, ctx.observed_models)
    status, reasons = derive_status(config, rows, results, metrics, alias_known, alias_present, scope_e2e)
    if aborted:
        reasons.append("aborted: " + aborted)
    return {"alias": model["alias"], "provider": model["provider"], "status": status, "reasons": reasons,
            "coverage": _coverage(rows), "capabilities": rows, "checks": results, "metrics": metrics}


def _coverage(rows):
    counts = {}
    for row in rows.values():
        counts[row["result"]] = counts.get(row["result"], 0) + 1
    exercised = sum(r["result"] in ("pass", "fail", "observed_unsupported") for r in rows.values())
    return {"capabilities": len(rows), "exercised": exercised, "by_result": counts}


# -------------------------------------------------------------------- state

def merge_state(report, previous, timestamp):
    """Carry forward last-success times; only passes ever advance them."""
    state = {"models": {}}
    for model in report["models"]:
        old = (previous or {}).get("models", {}).get(model["alias"], {})
        capabilities = dict(old.get("capabilities", {}))
        for capability, row in model["capabilities"].items():
            if row["result"] == "pass":
                capabilities[capability] = timestamp
        passed = any(row["result"] == "pass" for row in model["capabilities"].values())
        entry = {"healthy_at": timestamp if model["status"] == "healthy" else old.get("healthy_at"),
                 "any_check_at": timestamp if passed else old.get("any_check_at"), "capabilities": capabilities}
        state["models"][model["alias"]] = entry
        model["last_success"] = entry
    return state


def load_state(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except (OSError, ValueError, TypeError):
        return {}


def save_state(path, state):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
    os.replace(temporary, path)


# --------------------------------------------------------------------- main

def run(config, run_name, suite="all", base_url=None, key=None, target="live", aliases=None, seed=None,
        state_path=None, overrides=None, simulate=None, clock=now_iso):
    """Execute a run profile and return the structured report."""
    overrides = overrides or {}
    profile = config.runs(run_name)
    base_url = base_url or config.raw["endpoint"]["base_url"]
    redact = Redactor([key])
    timeouts = dict(config.raw["timeouts"])
    if overrides.get("timeout_scale"):
        timeouts = {k: v * overrides["timeout_scale"] for k, v in timeouts.items()}
    seed = seed if seed is not None else random.SystemRandom().randrange(1 << 30)
    unknown = sorted(set(aliases or []) - {m["alias"] for m in config.models})
    if unknown:
        raise ValueError("Unknown model alias requested: " + ", ".join(unknown))
    models = [m for m in config.models if not aliases or m["alias"] in aliases]
    report = {"schema": SCHEMA, "generated_at": clock(), "profile": run_name, "suite": suite,
              "target": {"kind": target, "base_url": base_url}, "seed": seed, "levels": {}, "models": [],
              "cursor": dict(config.raw["cursor"], suite_selected=suite in ("cursor", "all")),
              "routing": {"declared": {"strategy": config.raw["routing"]["strategy"],
                                       "session_affinity": config.raw["routing"]["session_affinity"]},
                          "live_verified": False,
                          "note": "Declared policy only: the live proxy's strategy is not observable through the API."}}
    live = liveness(base_url, redact, timeouts["liveness_s"])
    report["levels"]["liveness"] = live
    served, ready = set(), None
    if "readiness" in profile["levels"]:
        if live["status"] == "unhealthy" and live["category"] in ("transport", "timeout"):
            ready = _level("unknown", live["category"], ["endpoint unreachable; readiness not attempted"])
        else:
            retry = config.raw["retry"]
            ready, served = readiness(config, base_url, key, redact, timeouts["request_s"], retry["read_only"], retry["backoff_s"])
        report["levels"]["readiness"] = ready
    alias_known = ready is not None and (ready["status"] == "healthy" or ready["category"] == "alias_missing")
    scope_e2e = "e2e" in profile["levels"]
    cases = config.cases_for(suite, profile["max_tier"]) if scope_e2e else []
    limits = dict(profile.get("budget", {"max_requests": 1, "max_requests_per_model": 1, "max_output_tokens": 1, "concurrency": 1}))
    limits.update({k: v for k, v in overrides.items() if k in limits and v})
    budget = checks.Budget(limits["max_requests"], limits["max_requests_per_model"], limits["max_output_tokens"])

    def factory(alias):
        def on_request(kind):
            if kind in ("inference", "probe"):
                budget.take(alias)

        return Client(base_url, key, redact, timeouts["request_s"], on_request)

    def one(model):
        return run_model(config, model, cases, factory, budget, seed, redact, timeouts,
                         alias_known, model["alias"] in served, scope_e2e)

    with concurrent.futures.ThreadPoolExecutor(max_workers=limits["concurrency"]) as pool:
        report["models"] = list(pool.map(one, models))
    if scope_e2e:
        report["budget"] = {"requests_used": budget.used, "requests_max": limits["max_requests"],
                            "output_tokens_used": budget.tokens, "output_tokens_max": limits["max_output_tokens"],
                            "per_model_max": limits["max_requests_per_model"], "concurrency": limits["concurrency"],
                            "inference_retries": config.raw["retry"]["inference"]}
    report["simulations"] = simulate() if simulate and profile.get("simulations") else []
    state = merge_state(report, load_state(state_path) if state_path else {}, report["generated_at"])
    report["summary"] = summarize(config, report, profile)
    if state_path:
        save_state(state_path, state)
    return report


def summarize(config, report, profile):
    levels = {name: level["status"] for name, level in report["levels"].items()}
    models = {m["alias"]: m["status"] for m in report["models"]}
    failed_sims = [s["id"] for s in report["simulations"] if s["status"] != "pass"]
    scope_e2e = "e2e" in profile["levels"]
    judged = list(levels.values()) + (list(models.values()) if scope_e2e else
                                      [s for s in models.values() if s == "unhealthy"])
    top = "readiness" if "readiness" in levels else "liveness"
    if any(s == "unhealthy" for s in judged):
        overall = "unhealthy"
    elif any(s == "unknown" for s in judged) and (scope_e2e or levels[top] == "unknown"):
        overall = "unknown"
    elif any(s == "degraded" for s in judged) or failed_sims:
        overall = "degraded"
    else:
        overall = "healthy"
    return {"status": overall, "levels": levels, "models": models, "simulation_failures": failed_sims,
            "diagnostics": diagnostics(config, report)}


def diagnostics(config, report):
    """Actionable entries naming the level, model, endpoint, test and failure category."""
    advice = config.raw["diagnostics"]
    entries = []

    def add(**entry):
        entry["advice"] = advice.get(entry["category"], "")
        entries.append(entry)

    for name, level in report["levels"].items():
        if level["status"] in ("unhealthy", "unknown") and level["category"]:
            add(level=name, model=None, check=None, category=level["category"], details=level["details"])
    for model in report["models"]:
        for result in model["checks"]:
            if result["status"] == "fail":
                add(level="e2e", model=model["alias"], check=result["id"], endpoint=result["endpoint"],
                    category=result["category"], severity=result["severity"], details=result["details"])
            elif result["status"] == "untested":
                add(level="e2e", model=model["alias"], check=result["id"], category=result["category"], details=result["details"])
    for sim in report["simulations"]:
        if sim["status"] != "pass":
            add(level="simulation", model=None, check=sim["id"], category="harness", details=sim.get("details", []))
    return entries
