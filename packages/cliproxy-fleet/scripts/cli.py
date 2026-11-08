#!/usr/bin/env python3
"""Repository entry point for installing and operating the local service."""

import sys

sys.dont_write_bytecode = True


import os
import pathlib
import subprocess
import sys

source = pathlib.Path(__file__).resolve().parent
root = pathlib.Path(os.environ.get("CLIPROXY_ROOT", "/opt/cliproxy-fleet")).resolve()
args = sys.argv[1:]
if not args or args[0] in ["help", "--help", "-h"]:
    print(
        "Usage: personal infra-cliproxy COMMAND\nCommands: install [--revision REV|--rollback|--dry-run|--prepare-only], audit, public-endpoint [enable|start|disable|verify], status, start, stop, restart, health, models, logs, validate, apply FILE, add-account PROVIDER, inference PROTOCOL MODEL, backup, gc, snapshots, check, check-full, restore SNAPSHOT EMPTY_DIRECTORY, restore-cache --previous-node-stopped, vault-login, recover, recover-node NEW_DIRECTORY [--vault-token-file FILE], verify-recovery, portable-login, activate, drain"
    )
    sys.exit(0)
command, *rest = args
if command == "install":
    invocation = [sys.executable, str(source / "install.py"), *rest]
    if os.geteuid() != 0 and "--dry-run" not in rest:
        invocation = ["sudo", *invocation]
elif command == "recover-node":
    invocation = [sys.executable, "-B", str(root / "scripts/recover_node.py"), *rest]
elif command == "public-endpoint":
    invocation = [str(root / "scripts/public-endpoint"), *rest]
elif command == "audit":
    invocation = [sys.executable, str(root / "scripts/audit.py"), *rest]
elif command in [
    "backup",
    "gc",
    "snapshots",
    "check",
    "check-full",
    "restore",
    "restore-cache",
]:
    invocation = [str(root / "scripts/backup"), command, *rest]
elif command in ["vault-login", "recover", "verify-recovery"]:
    invocation = [
        str(
            root
            / "scripts"
            / ("vault-backup-login" if command == "vault-login" else "vault-recovery")
        )
    ]
    if command != "vault-login":
        invocation.append("recover" if command == "recover" else "verify")
else:
    invocation = [str(root / "scripts/ops"), command, *rest]
raise SystemExit(subprocess.call(invocation))
