#!/usr/bin/env python3
"""Bounded job identity from runner hooks; never collect a job's environment or output."""
import json
import os
import re
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SLOT = re.compile(r"slot-([1-9]|[1-5][0-9]|6[0-4])")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}")
JOB_NAME = re.compile(r"[A-Za-z0-9_. /:()@+-]{1,120}")


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def identity(env):
    repository = env.get("GITHUB_REPOSITORY", "")
    if len(repository) > 120 or not REPOSITORY.fullmatch(repository) or any(part in (".", "..") for part in repository.split("/")):
        repository = None
    run_id = env.get("GITHUB_RUN_ID", "")
    job = env.get("GITHUB_JOB", "")
    return {"repository": repository, "runId": run_id if RUN_ID.fullmatch(run_id) else None,
            "jobName": job if JOB_NAME.fullmatch(job) else None}


def record(event, env=None):
    env = os.environ if env is None else env
    slot = env.get("FLEET_SLOT", "")
    if not SLOT.fullmatch(slot) or event not in ("started", "completed", "stopped"):
        return False
    directory = Path(env.get("FLEET_RUN", "/run/fleet")) / slot
    path = directory / "job.json"
    previous = {}
    try:
        flags = os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(path, flags), encoding="utf-8") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
                raise ValueError()
            previous = json.loads(handle.read(8193))
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError, RecursionError):
        pass
    if event == "stopped" and (not previous.get("startedAt") or previous.get("finishedAt")):
        return True
    now = timestamp()
    if event == "started":
        value = dict(identity(env), startedAt=now, finishedAt=None, result=None)
    else:
        # Preserve the identity captured at start; a completed hook does not
        # prove success/failure, which must be read from the GitHub run.
        value = {name: previous.get(name) for name in ("repository", "runId", "jobName", "startedAt")}
        value.update(finishedAt=now, result="interrupted" if event == "stopped" else "completed")
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".job-", dir=directory)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, separators=(",", ":"))
            handle.write("\n")
        os.replace(temporary, path)
        return True
    except OSError:
        return False
    finally:
        if temporary:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        available = len(argv) == 1 and record(argv[0])
    except Exception:
        # These files are controlled by an unprivileged runner. Diagnostic
        # failure must neither stop project work nor print raw exception data.
        available = False
    if not available:
        print("fleet-runner-job: job diagnostic metadata unavailable", file=sys.stderr)
    # Best-effort reporting must never stop a runner from doing its job.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
