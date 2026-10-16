#!/usr/bin/env python3
"""Build every flake check once, across bounded GitHub-hosted jobs."""
import json
import subprocess
import sys


GROUPS = ("roles", "runtime", "lifecycle", "image")
SPECIAL = {
    "runtime": {"vm", "web-vm", "devbox-vm", "cattle-vm"},
    "lifecycle": {"lifecycle", "follow-up", "netboot-vm"},
    "image": {"installer"},
}


def partition(names):
    groups = {name: [] for name in GROUPS}
    for name in sorted(names):
        # New checks default to roles, so adding a flake check cannot silently
        # omit it from CI. Explicit groups only distribute the expensive work.
        group = next((key for key, values in SPECIAL.items() if name in values), "roles")
        groups[group].append(name)
    return groups


def run(group):
    if group not in GROUPS:
        raise ValueError(f"unknown check group: {group}")
    # Use Git flake references everywhere. path:. discards self.rev and causes
    # different role closures (and another ISO) with revision=unknown.
    names = json.loads(subprocess.check_output([
        "nix", "eval", "--no-write-lock-file", "--json",
        ".#checks.x86_64-linux", "--apply", "builtins.attrNames",
    ], text=True))
    selected = partition(names)[group]
    if not selected:
        raise ValueError(f"empty check group: {group}")
    if group == "roles":
        # Validate every output, including ci-gpu. Builds run in the four
        # groups below instead of all serializing behind ISO compression.
        subprocess.run([
            "nix", "flake", "check", "--no-build", "--no-write-lock-file",
            "--system", "x86_64-linux",
        ], check=True)
    print(f"{group}: {', '.join(selected)}", flush=True)
    subprocess.run([
        "nix", "build", "--no-write-lock-file", "--max-jobs", "2", "--cores", "2",
        "-L", "-o", "result-iso" if group == "image" else f"result-{group}",
        *(f".#checks.x86_64-linux.{name}" for name in selected),
    ], check=True)


if __name__ == "__main__":
    run(sys.argv[1])
