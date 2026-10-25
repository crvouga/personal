"""The wizard's local web server. It never runs privileged.

Every API request must carry this run's secret and a Host header naming the
loopback address, so a web page in the person's browser or another program on
the machine cannot drive it. Destructive work happens in `helper.py`, started
through the operating system's own permission prompt.
"""
import hmac
import json
import os
import secrets
import shutil
import socketserver
import threading
import time
import traceback
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import bootstrap  # noqa: F401
import decide
import diagnostics
import elevate
import imaging
import fleet_tls
import preparation
import fleet_wifi

try:
    from _version import VERSION
except ImportError:
    VERSION = "dev"
MAX_BODY = 64 * 1024
TOKEN_MAX = 512
PROBLEM_FIELD_MAX = 4000
QUIET_STEPS = (None, "", "log", "verify")  # helper steps that change nothing
PLAN_TTL = 15 * 60

OS_LABEL = {"Darwin": "macOS"}

ROLE_INFO = {
    "ci": ("CI runner", "Runs GitHub Actions jobs for the repository."),
    "web": ("Web server", "Hosts the apps behind Caddy."),
    "cache": ("Build cache", "The attic binary cache the other nodes pull from."),
    "netboot": ("Network boot server", "Lets machines on this network start from the network."),
    "devbox": ("Remote devbox", "SSH development machine with persistent workspace and development tools."),
}

# A job moves forward only. Anything else is a bug and stops loudly.
TRANSITIONS = {
    "idle": ("downloading",),
    "downloading": ("working", "failed", "cancelled"),
    "working": ("done", "failed"),
    "done": ("downloading",),
    "failed": ("downloading",),
    "cancelled": ("downloading",),
}


def resource(name):
    """index.html lives next to this file, or inside the frozen app."""
    import sys

    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


def installer_urls():
    return decide.installer_urls()


def lookup_token_http(token, role):
    """decide.lookup_token without curl."""
    url = f"{decide.vault_addr()}/v1/sys/wrapping/lookup"
    request = urllib.request.Request(url, data=json.dumps({"token": token}).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=20) as reply:
            return decide.lookup_verdict(role, reply.status, "", json.loads(reply.read().decode("utf-8", "replace")).get("data") or {})
    except urllib.error.HTTPError as exc:
        return decide.lookup_verdict(role, exc.code, f"HTTP {exc.code}", None)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return decide.lookup_verdict(role, None, str(getattr(exc, "reason", exc)), None)


class Job:
    def __init__(self):
        self.state = "idle"
        self.percent = None
        self.message = ""
        self.log = []
        self.result = None
        self.mode = None
        self.role = None
        self.step = None
        self.changed = False  # the privileged helper may have changed this computer
        self.cancel = threading.Event()
        self.lock = threading.Lock()

    def move(self, new, result=None):
        with self.lock:
            decide.invariant(new in TRANSITIONS[self.state], "illegal job state change", state=self.state, to=new)
            if new == "working" and self.cancel.is_set():
                raise imaging.Cancelled()
            if new in ("done", "failed", "cancelled"):
                decide.invariant(isinstance(result, dict) and result.get("ok") is (new == "done"),
                                 "a terminal job must have a matching result", state=new, result=result)
                self.result = result
            self.state = new

    def request_cancel(self):
        with self.lock:
            decide.invariant(self.state == "downloading", "disk work has already started or finished",
                             "Wait for the result. Do not unplug the disk while it is being written.")
            self.cancel.set()

    def note(self, message, percent=None, step=None):
        with self.lock:
            if step:
                self.step = step
            if message:
                message = decide.redact(str(message))
                self.message = message
                self.log.append(message)
                del self.log[:-200]
            if percent is not None:
                self.percent = percent

    def snapshot(self):
        with self.lock:
            return {"version": VERSION, "state": self.state, "step": self.step, "mode": self.mode, "role": self.role, "percent": self.percent,
                    "message": self.message, "log": list(self.log), "result": self.result}


class Wizard:
    def __init__(self, os_name=None):
        self.os_name = os_name or decide.current_os()
        self.secret = secrets.token_urlsafe(24)
        self.plan = None
        self.job = Job()
        self.lock = threading.Lock()
        decide.NET["probe"] = self.probe_installer
        decide.NET["lookup"] = lookup_token_http

    # ---- facts -------------------------------------------------------------

    def probe_installer(self):
        return imaging.probe(installer_urls()[0])

    def disks(self):
        try:
            return decide.collect(self.os_name), None
        except (OSError, RuntimeError, ValueError, decide.subprocess.CalledProcessError) as exc:
            return [], f"This computer's disks could not be listed ({exc})."

    def usb_choices(self, disks):
        return [
            {"id": decide.disk_id(d), "path": d["path"], "plain": decide.plain_name(d), "size": int(d.get("size") or 0), "mounted": bool(d.get("mounted"))}
            for d in disks
            if decide.media_block(d) in (None, "mounted")
        ]

    def here_blockers(self, disks, internal):
        reasons = []
        if self.os_name not in ("Linux", "Windows"):
            reasons.append(f"{OS_LABEL.get(self.os_name, self.os_name)} cannot restart straight into the installer. Make an install USB instead; it works from any computer.")
        if decide.machine_arch() not in decide.X86:
            reasons.append(f"This computer is {decide.machine_arch()}. Nodes are x86_64 UEFI machines, so this one can make a USB for another computer but cannot become a node.")
        if self.os_name == "Linux" and not (shutil.which(decide.os_boot_tool("Linux")) or os.path.isfile(decide.os_boot_tool("Linux"))):
            if not preparation.linux_boot_commands():
                reasons.append("The Linux boot tool cannot be prepared automatically on this system. Make an install USB instead.")
        if not internal["ok"]:
            reasons.append(internal["next"].replace("Next: ", "", 1).replace(" Nothing was written.", ""))
        return reasons

    def scan(self):
        disks, disk_error = self.disks()
        internal = decide.plan_disks(disks, "install") if not disk_error else {"ok": False, "next": disk_error}
        error, size = imaging.probe(installer_urls()[0])
        node = decide.read_kv(os.environ.get("FLEET_NODE_CONF", "/etc/fleet/node.conf"))
        return {
            "version": VERSION,
            "os": OS_LABEL.get(self.os_name, self.os_name),
            "arch": decide.machine_arch(),
            "admin": elevate.is_admin(self.os_name),
            "roles": [{"id": role, "title": ROLE_INFO[role][0], "blurb": ROLE_INFO[role][1]} for role in decide.ROLES],
            "node_role": decide.node_role(node) or None,
            "usb": self.usb_choices(disks),
            "internal": {"ok": internal["ok"], "plain": internal.get("plain"), "id": internal.get("disk_id")},
            "here_blockers": self.here_blockers(disks, internal),
            "release": {"ok": error is None, "error": error, "size": size, "advice": fleet_tls.advice(error),
                        "guidance": diagnostics.guidance(str(error), fleet_tls.advice(error), changed=False) if error else None},
            "log": decide.LOG["path"],
        }

    # ---- plan --------------------------------------------------------------

    def make_plan(self, body):
        wifi = body.get("wifi")
        if wifi is not None:
            try:
                wifi = fleet_wifi.validate(wifi)
            except fleet_wifi.WifiError as exc:
                decide.invariant(False, str(exc), "Check the Wi-Fi network name and password.")
        mode = body.get("mode")
        decide.invariant(mode in ("usb", "here"), "the plan request names an unknown mode", mode=mode)
        role = body.get("role") or None
        reinstall = body.get("reinstall", False)
        decide.invariant(isinstance(reinstall, bool), "reinstall must be a boolean")
        decide.invariant(not reinstall or mode == "here", "a hard reinstall must target this computer")
        ssh_key = decide.validate_ssh_key(body.get("ssh_key")) if mode == "here" and role == "devbox" else None
        token = (body.get("token") or "").strip() or None
        if role is not None:
            decide.invariant(role in decide.ROLES, "the plan request names an unknown role", role=role)
        if token is not None:
            decide.invariant(len(token) <= TOKEN_MAX and decide.ENROLL_RE.fullmatch(token) is not None,
                             "that does not look like an enrollment token", "Paste the token exactly as `just enroll` printed it.")
        disks, disk_error = self.disks()
        decide.invariant(not disk_error, "could not list the disks", disk_error or "")
        directory = decide.state_dir()
        if mode == "usb":
            choices = [d for d in self.usb_choices(disks) if d["id"] == body.get("disk_id")]
            decide.invariant(len(choices) == 1, "the USB disk is not present uniquely", "Unplug other identical sticks, press Rescan, and choose it again.", disk_id=body.get("disk_id"))
            chosen = choices[0]
            findings = decide.preflight(self.os_name, None, "media", None, directory, need_root=False)
            error, size = imaging.probe(installer_urls()[0])
            if not chosen["size"] or size and chosen["size"] < imaging.padded(size):
                findings.append(decide.finding("usb-size", "fail", f"the USB disk holds {chosen['size'] // 10**9} GB, the installer needs {size // 10**9 + 1} GB",
                                               "Use a larger USB disk."))
            else:
                findings.append(decide.finding("usb-size", "ok", chosen["plain"]))
            erase, disk_id, target = chosen["plain"], chosen["id"], chosen["path"]
            summary = f"This erases the USB disk {chosen['plain']} and writes the installer to it. Nothing else on this computer changes."
            summary += " Available Wi-Fi settings are saved on the USB for automatic connection. Keep this USB private: it can contain the network password."
        else:
            decide.invariant(role is not None, "choose what kind of node this computer should become")
            internal = decide.plan_disks(disks, "install")
            blockers = self.here_blockers(disks, internal)
            decide.invariant(not blockers, "this computer cannot install itself", " ".join(blockers))
            findings = decide.preflight(self.os_name, role, "install", token, directory, need_root=False, ssh_key=ssh_key,
                                        auto_enroll=decide.enroll_enabled(), disk_path=internal["path"],
                                        iso_path=imaging.cache_dir(self.os_name) / "fleet-installer.iso")
            findings = preparation.review_findings(self.os_name, findings)
            erase, disk_id, target = internal["plain"], internal["disk_id"], internal["path"]
            summary = f"This erases {internal['plain']}, including this computer's operating system and every file on it, and installs a {ROLE_INFO[role][0]}."
            if reinstall:
                summary = "Hard reinstall: replace the existing installation, even if it already has this role. " + summary
            if self.os_name == "Windows":
                summary += " Windows preparation, boot setup and restart are automatic. Back up your files and save your BitLocker recovery key on another device before continuing."
            summary += " The installer will prepare the required tools, repeat its checks, install and restart automatically."
        problems = [item for item in findings if item["status"] == "fail"]
        plan = {
            "id": secrets.token_hex(8), "mode": mode, "role": role, "reinstall": reinstall, "token": token, "ssh_key": ssh_key, "disk_id": disk_id, "path": target,
            "wifi": wifi,
            "erase": erase, "summary": summary, "findings": findings, "ready": not problems, "created": time.time(),
        }
        with self.lock:
            decide.invariant(self.job.snapshot()["state"] in ("idle", "done", "failed", "cancelled"),
                             "a job is already running", "Wait for the current job to finish.")
            self.plan = plan
        public = {k: v for k, v in plan.items() if k not in ("token", "ssh_key", "wifi", "path", "created")}
        decide.log(f"plan {plan['id']} mode={mode} role={role} ready={plan['ready']} erase={erase}")
        return public

    # ---- run ---------------------------------------------------------------

    def start(self, body):
        with self.lock:
            decide.invariant(self.job.snapshot()["state"] in ("idle", "done", "failed", "cancelled"), "a job is already running")
            plan = self.plan
            decide.invariant(plan is not None and body.get("plan_id") == plan["id"], "that plan is not the current one", "Go back and review the plan again.")
            decide.invariant(time.time() - plan["created"] <= PLAN_TTL, "that review has expired", "Review the disk and checks again.")
            decide.invariant(plan["ready"], "the plan has failed checks", "Fix the failed checks on the review page first.")
            decide.invariant(body.get("ack") is True, "the erase was not acknowledged", "Tick the box that says you understand the disk will be erased.")
            decide.invariant(body.get("disk_id") == plan["disk_id"], "the acknowledged disk is not the planned disk", "Review the plan again.")
            decide.invariant(self.job.snapshot()["state"] in ("idle", "done", "failed", "cancelled"), "a job is already running")
            self.job = Job()
            self.job.mode = plan["mode"]
            self.job.role = plan["role"]
            self.job.move("downloading")
            job = self.job
            self.plan = None  # acknowledgement is single-use, even if the run fails
        threading.Thread(target=self.run_job, args=(job, plan), daemon=True).start()
        return {"started": True}

    def run_job(self, job, plan):
        try:
            iso_url, sum_url = installer_urls()
            job.note("Looking up the installer checksum")
            def release():
                checksum = imaging.fetch_checksum(sum_url)
                if plan['mode'] == 'here':
                    decide.check_release_readiness(plan['role'], checksum, iso_url)
                return checksum
            sha = imaging.retry(release, job.note, job.cancel.is_set)
            target = imaging.cache_dir(self.os_name) / "fleet-installer.iso"
            job.note("Downloading the installer", 0)
            imaging.download(iso_url, target, sha,
                             lambda done, total: job.note("", int(done * 100 / total) if total else None),
                             cancel=job.cancel.is_set, retry_note=job.note)
            job.note("Download verified", 100)
            if plan["mode"] == "here":
                decide.check_installer_readiness(target, plan["role"])
            if plan["mode"] == "here" and not plan["token"] and decide.enroll_enabled():
                plan = self.enroll(job, plan)
            job.move("working")
            self.run_helper(job, plan, target, sha)
        except imaging.Cancelled:
            job.move("cancelled", {"ok": False, "message": "Cancelled. Nothing was erased.", "fix": "", "log": decide.LOG["path"],
                                   "guidance": {"summary": "", "steps": ["Press Try again to review the same installation again."], "retry": True,
                                                "safety": "Nothing on this computer was erased or changed."}})
        except decide.Invariant as broken:
            self.fail(job, f"{broken.what} ({'; '.join(f'{k}={v}' for k, v in broken.context.items())})", broken.fix)
        except Exception as exc:
            decide.log(traceback.format_exc(), "ERROR")
            self.fail(job, f"{type(exc).__name__}: {exc}", "Read the log, then run the wizard again.")

    def enroll(self, job, plan):
        """Ask the repository owner to approve this node on GitHub. Nothing has
        been erased, so a refusal or a timeout ends the job cleanly."""
        token, error = decide.self_enroll(plan["role"], notify=job.note, cancel=job.cancel.is_set)
        if error == "cancelled":
            raise imaging.Cancelled()
        decide.invariant(token is not None, f"this computer was not approved ({error})",
                         "Run the wizard again and press 'Submit new issue' on the GitHub page, or paste an enrollment token.")
        verdict = decide.NET.get("lookup", lookup_token_http)(token, plan["role"])
        decide.invariant(verdict["status"] != "fail", f"the approval token is not usable ({verdict['detail']})", verdict["fix"])
        return {**plan, "token": token}

    def fail(self, job, message, fix, log=None):
        message = decide.redact(message)
        decide.log(f"job failed: {message} fix={fix}", "ERROR")
        job.move("failed", {"ok": False, "message": message, "fix": fix, "log": log or decide.LOG["path"],
                            "guidance": diagnostics.guidance(message, fix, changed=job.changed)})

    def follow(self, job, path, offset, unreadable):
        """Show the helper's new progress. Unreadable progress never ends the job:
        the helper may be writing a disk, so the window keeps waiting for it."""
        try:
            rows, offset = elevate.read_progress(path, offset)
        except OSError as exc:
            if not unreadable:
                decide.log(f"helper progress is unreadable: {type(exc).__name__}: {exc}", "WARN")
                job.changed = True  # unknown, so assume the worst
                job.note("The administrator step is running, but its progress cannot be shown here. Waiting for it to finish.")
            return offset, True
        for row in rows:
            if row.get("step") not in QUIET_STEPS:
                job.changed = True
            job.note(row.get("message", ""), row.get("percent"), row.get("step"))
        return offset, unreadable

    def run_helper(self, job, plan, iso, sha):
        scratch = imaging.scratch_dir("fleet-job-")
        process = None
        try:
            request = {"action": "write-usb" if plan["mode"] == "usb" else "install-here", "iso": str(iso), "sha256": sha,
                       "disk_id": plan["disk_id"], "path": plan["path"], "role": plan["role"], "reinstall": plan["reinstall"], "token": plan["token"], "ssh_key": plan["ssh_key"], "wifi": plan.get("wifi")}
            fd = os.open(scratch / "request.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as handle:
                json.dump(request, handle)
            job.note("Waiting for permission to change the disk")
            try:
                process = elevate.start(self.os_name, elevate.helper_argv(scratch))
            except elevate.ElevationUnavailable as exc:
                return self.fail(job, str(exc), "Run the installer with administrator rights.")
            offset, unreadable = 0, False
            while process.poll() is None:
                offset, unreadable = self.follow(job, scratch / "progress.jsonl", offset, unreadable)
                time.sleep(0.25)
            offset, unreadable = self.follow(job, scratch / "progress.jsonl", offset, unreadable)
            result_file = scratch / "result.json"
            try:
                text = result_file.read_text(encoding="utf-8") if result_file.is_file() else None
            except OSError as exc:
                return self.fail(job, f"The administrator step finished (exit code {process.returncode}), but the installer could not read the administrator step's result "
                                      f"({type(exc).__name__}: {exc}).", "Read the log to see what it did before trying again.")
            if text is None:
                if unreadable:
                    return self.fail(job, f"The administrator step finished (exit code {process.returncode}), but the installer could not read the administrator step's result.",
                                     "Read the log to see what it did before trying again.")
                return self.fail(job, f"The privileged step ended without a result (exit code {process.returncode}). The permission prompt was probably declined.",
                                 "Run the wizard again and accept the permission prompt.")
            result = json.loads(text)
            decide.invariant(isinstance(result, dict) and isinstance(result.get("ok"), bool), "the helper wrote a malformed result", result=result)
            if result["ok"]:
                decide.invariant(process.returncode == 0, "the helper reported success but exited with an error", code=process.returncode)
                job.move("done", result)
            else:
                self.fail(job, result.get("message", ""), result.get("fix", ""), result.get("log"))
        finally:
            try:
                if process is not None and process.poll() is None:
                    # Never delete the folder from under a helper that may be writing a disk.
                    decide.log("waiting for the privileged helper to exit before cleaning up", "WARN")
                    process.wait()
            finally:
                shutil.rmtree(scratch, ignore_errors=True)

    # ---- diagnostics -------------------------------------------------------

    def diagnostic(self, body):
        """A copyable report and a pre-filled GitHub issue for the current job,
        or for an error the page met outside a job."""
        problem = body.get("problem")
        decide.invariant(problem is None or isinstance(problem, dict), "the diagnostic problem must be an object")
        problem = {key: str(value)[:PROBLEM_FIELD_MAX] for key, value in (problem or {}).items()
                   if key in ("message", "fix", "where", "mode", "role") and value is not None}
        if problem.get("message"):
            problem["guidance"] = diagnostics.guidance(problem["message"], problem.get("fix", ""))
        job = self.job.snapshot()
        if job["state"] == "idle":
            job = None
        try:
            elevation = elevate.mode_for(self.os_name)
        except decide.Invariant as broken:
            elevation = broken.what
        facts = diagnostics.system_facts(OS_LABEL.get(self.os_name, self.os_name), elevate.is_admin(self.os_name), elevation)
        build = lambda lines: diagnostics.report(VERSION, facts, job, problem, lines, decide.LOG["path"])  # noqa: E731
        message = problem.get("message") or ((job or {}).get("result") or {}).get("message") or (job or {}).get("message")
        title = diagnostics.issue_title(message)
        return {"report": build(diagnostics.LOG_TAIL), "title": title, "issue_url": diagnostics.issue_url(title, build)}


class Handler(BaseHTTPRequestHandler):
    server_version = "fleet-wizard"
    wizard = None  # set by serve()

    def log_message(self, fmt, *args):
        decide.log("http " + (fmt % args).replace(self.wizard.secret, "[redacted]"))

    def reply(self, code, payload, kind="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self' 'unsafe-inline'; connect-src 'self'")
        self.end_headers()
        self.wfile.write(data)

    def allowed(self, public_page=False):
        port = self.server.server_address[1]
        host = self.headers.get("Host", "")
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            return "bad host"
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{port}", f"http://localhost:{port}"):
            return "bad origin"
        if public_page:
            # This static page contains no secret or machine facts. Serving it
            # lets Reload recover the API token from this tab's sessionStorage.
            return None
        supplied = self.headers.get("X-Fleet-Token") or ""
        if "?t=" in self.path:
            supplied = supplied or self.path.split("?t=", 1)[1].split("&", 1)[0]
        if not hmac.compare_digest(supplied.encode(), self.wizard.secret.encode()):
            return "bad token"
        return None

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        decide.invariant(0 <= length <= MAX_BODY, "request body too large", length=length)
        if length == 0:
            return {}
        decide.invariant((self.headers.get("Content-Type") or "").startswith("application/json"), "request is not JSON")
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        decide.invariant(isinstance(data, dict), "request body is not an object")
        return data

    def route(self, method):
        path = self.path.split("?", 1)[0]
        refusal = self.allowed(public_page=method == "GET" and path in ("/", "/admin.css", "/theme.js"))
        if refusal:
            return self.reply(403, {"error": refusal})
        try:
            if method == "GET" and path == "/":
                return self.reply(200, resource("index.html").read_bytes(), "text/html; charset=utf-8")
            if method == "GET" and path in ("/admin.css", "/theme.js"):
                name, kind = ("admin.css", "text/css; charset=utf-8") if path == "/admin.css" else ("theme.js", "text/javascript; charset=utf-8")
                return self.reply(200, resource(name).read_bytes(), kind)
            if method == "GET" and path == "/api/scan":
                return self.reply(200, self.wizard.scan())
            if method == "GET" and path == "/api/job":
                return self.reply(200, self.wizard.job.snapshot())
            if method == "POST" and path == "/api/plan":
                return self.reply(200, self.wizard.make_plan(self.body()))
            if method == "POST" and path == "/api/run":
                return self.reply(200, self.wizard.start(self.body()))
            if method == "POST" and path == "/api/diagnostic":
                return self.reply(200, self.wizard.diagnostic(self.body()))
            if method == "POST" and path == "/api/quit":
                self.reply(200, {"quit": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return None
            if method == "POST" and path == "/api/cancel":
                self.wizard.job.request_cancel()
                return self.reply(200, {"cancelled": True})
            return self.reply(404, {"error": "not found"})
        except decide.Invariant as broken:
            decide.log(f"refused: {broken.what} {broken.context}")
            return self.reply(409, {"error": broken.what, "fix": broken.fix, "context": broken.context,
                                    "guidance": diagnostics.guidance(broken.what, broken.fix, changed=None)})
        except (ValueError, KeyError) as exc:
            return self.reply(400, {"error": f"bad request: {exc}", "fix": "Reload the page."})
        except Exception as exc:
            decide.log(traceback.format_exc(), "ERROR")
            error = f"{type(exc).__name__}: {exc}"
            return self.reply(500, {"error": error, "fix": "Read the log, then run the wizard again.", "log": decide.LOG["path"],
                                    "guidance": diagnostics.guidance(error, "", changed=None)})

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")


class LoopbackServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer resolves its hostname here. A loopback-only wizard needs
        # no DNS; slow macOS reverse lookups can block it before it prints a URL.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def serve(wizard, port=0):
    bound = type("BoundHandler", (Handler,), {"wizard": wizard})
    server = LoopbackServer(("127.0.0.1", port), bound)
    decide.invariant(server.server_address[0] == "127.0.0.1", "the server must listen on loopback only", address=server.server_address)
    return server


def url_for(server, wizard):
    return f"http://127.0.0.1:{server.server_address[1]}/?t={wizard.secret}"
