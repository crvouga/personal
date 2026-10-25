"""Root-only GitHub App operations; never log credentials or API response bodies.

The filename must not be token.py: that shadows Python's standard token module.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import jwt


class GitHubUnavailable(RuntimeError):
    """Temporary transport, throttling, or server failure; no private body."""


def request(method, path, token, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request("https://api.github.com" + path, data=body, method=method,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "workspace-ci-fleet"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return None if response.status == 204 else json.load(response)
    except urllib.error.HTTPError as error:
        throttled = error.code == 403 and (error.headers.get('Retry-After') or error.headers.get('X-RateLimit-Remaining') == '0')
        if error.code in (408, 429) or error.code >= 500 or throttled:
            raise GitHubUnavailable('GitHub is temporarily unavailable') from None
        raise RuntimeError("GitHub API returned HTTP " + str(error.code)) from None
    except (urllib.error.URLError, OSError):
        raise GitHubUnavailable('GitHub could not be reached') from None


def app_token(app, installation, key_path):
    with open(key_path, encoding="utf-8") as key:
        now = int(time.time())
        signed = jwt.encode({"iat": now - 60, "exp": now + 540, "iss": str(app)}, key.read(), algorithm="RS256")
    return request("POST", "/app/installations/" + str(installation) + "/access_tokens", signed)["token"]


def matching_runners(host, runners):
    return [runner for runner in runners if runner["name"].startswith(host + "-") or runner["name"] == host]


def delete_custom_labels(prefix, access, runners):
    # Remove routing labels so new work cannot be assigned. Do not delete the runner.
    defaults = {"self-hosted", "linux", "x64"}
    for runner in runners:
        labels = [label["name"] for label in runner.get("labels", []) if label["name"].lower() not in defaults]
        for label in labels:
            request("DELETE", prefix + "/" + str(runner["id"]) + "/labels/" + urllib.parse.quote(label, safe=""), access)


def list_runners(scope, target, access):
    endpoint = ("/orgs/" if scope == "organization" else "/repos/") + target + "/actions/runners"
    result = []
    page = 1
    while True:
        response = request("GET", endpoint + "?per_page=100&page=" + str(page), access)
        result.extend(response["runners"])
        if len(response["runners"]) < 100:
            return result
        page += 1



def main():
    mode, scope, target, app, installation, key_path, *args = sys.argv[1:]
    if scope not in ("organization", "repository"):
        raise ValueError("invalid GitHub runner scope")
    if not app.isdigit() or not installation.isdigit() or "TODO" in target:
        raise ValueError("Configure App identifiers and registration scope")
    access = app_token(app, installation, key_path)
    prefix = ("/orgs/" if scope == "organization" else "/repos/") + target + "/actions/runners"
    if mode == "status":
        if len(args) != 1:
            raise ValueError("runner status requires the node hostname")
        runners = matching_runners(args[0], list_runners(scope, target, access))
        slots = {args[0] + "-slot-" + str(slot) for slot in range(1, 65)}
        online_names = sorted({r["name"] for r in runners if r.get("status") == "online" and r["name"] in slots})
        print(json.dumps({"registered": len(runners), "online": sum(r.get("status") == "online" for r in runners),
                          "onlineNames": online_names}))
        return
    if mode == "register":
        if len(args) != 1:
            raise ValueError("registration output path is required")
        output = args[0]
        registration = request("POST", prefix + "/registration-token", access)["token"]
        os.makedirs(os.path.dirname(output), mode=0o700, exist_ok=True)
        fd = os.open(output + ".new", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(registration)
        os.replace(output + ".new", output)
        return
    if mode in ("hold", "withdraw"):
        if len(args) != 1:
            raise ValueError("usage: runner-control hold|withdraw SCOPE TARGET APP INSTALL KEY HOST")
        host = args[0]
        runners = matching_runners(host, list_runners(scope, target, access))
        if mode == "hold":
            delete_custom_labels(prefix, access, runners)
            return
        if any(runner.get("busy") for runner in runners):
            delete_custom_labels(prefix, access, runners)
            print("A job is still running. Runners were not deleted.", file=sys.stderr)
            sys.exit(4)
        for runner in runners:
            request("DELETE", prefix + "/" + str(runner["id"]), access)
        return
    if mode != "drain" or len(args) != 2:
        raise ValueError("usage: runner-control drain SCOPE TARGET APP INSTALL KEY HOST TIMEOUT")
    host, timeout_text = args
    timeout = int(timeout_text)
    deadline = time.monotonic() + timeout
    runners = [r for r in list_runners(scope, target, access) if r["name"].startswith(host + "-") or r["name"] == host]
    if not runners:
        sys.exit(3)  # This repository may have no slot due to round-robin placement.
    # Remove every non-default routing label so project workflows cannot assign new jobs.
    defaults = {"self-hosted", "linux", "x64"}
    for runner in runners:
        labels = [label["name"] for label in runner.get("labels", []) if label["name"].lower() not in defaults]
        for label in labels:
            request("DELETE", prefix + "/" + str(runner["id"]) + "/labels/" + urllib.parse.quote(label, safe=""), access)
    refreshed = time.monotonic()
    while True:
        if time.monotonic() - refreshed > 2700:
            access = app_token(app, installation, key_path)
            refreshed = time.monotonic()
        current = [r for r in list_runners(scope, target, access) if r["name"].startswith(host + "-") or r["name"] == host]
        if not current or all(not r.get("busy", False) for r in current):
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("drain timed out; labels remain removed, no jobs were stopped")
        time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except GitHubUnavailable:
        print('FLEET_GITHUB_UNAVAILABLE: retry the bounded GitHub operation after connectivity or throttling recovers.', file=sys.stderr)
        sys.exit(75)
    except Exception as error:
        print("Fleet GitHub operation failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
