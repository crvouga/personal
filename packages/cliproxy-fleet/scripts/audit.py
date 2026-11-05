#!/usr/bin/env python3
"""Require runtime code and unit links to resolve to clean, Git-tracked files."""

import sys

sys.dont_write_bytecode = True

import hashlib
import json
import os
import pathlib
import subprocess
import sys


def audit(root, check_units=True):
    manifest = json.loads((root / "INSTALLATION.json").read_text())
    errors = []
    if manifest.get("schema_version") != 2:
        return manifest, [
            "legacy copied-code installation; reinstall from the repository"
        ]
    worktree = pathlib.Path(manifest["worktree"])
    command = [
        "git",
        "--no-optional-locks",
        "-c",
        "safe.directory=" + str(worktree),
        "-C",
        str(worktree),
    ]
    revision = (
        subprocess.check_output(command + ["rev-parse", "HEAD"], stderr=subprocess.PIPE)
        .decode()
        .strip()
    )
    tracked = set(
        subprocess.check_output(
            command + ["ls-files", "-z", "--", manifest["package"]],
            stderr=subprocess.PIPE,
        )
        .decode()
        .strip("\0")
        .split("\0")
    )
    if revision != manifest["revision"]:
        errors.append("deployment worktree revision")
    if subprocess.check_output(
        command + ["status", "--porcelain", "--", manifest["package"]],
        stderr=subprocess.PIPE,
    ).strip():
        errors.append("deployment worktree has local changes")
    source = worktree / manifest["package"]
    for name, expected in manifest["files"].items():
        path = root / name
        if (
            manifest["package"] + "/" + name not in tracked
            or not path.is_file()
            or path.resolve() != source / name
            or hashlib.sha256(path.read_bytes()).hexdigest() != expected
        ):
            errors.append(name)
        if check_units and name.startswith("systemd/"):
            unit = pathlib.Path("/etc/systemd/system") / path.name
            if not unit.is_symlink() or unit.resolve() != source / name:
                errors.append(str(unit))
    for name, expected in manifest["generated"].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            errors.append(name)
    for folder in ["scripts", "clients", "systemd"]:
        for path in (root / folder).rglob("*"):
            if (
                path.is_file()
                and "__pycache__" not in path.parts
                and str(path.relative_to(root)) not in manifest["files"]
            ):
                errors.append("unmanaged: " + str(path.relative_to(root)))
    return manifest, errors


if __name__ == "__main__":
    try:
        manifest, errors = audit(
            pathlib.Path(os.environ.get("CLIPROXY_ROOT", "/opt/cliproxy-fleet"))
        )
        if errors:
            print("Code is not clean tracked repository source: " + ", ".join(errors))
            sys.exit(1)
        print(
            "Runtime code is Git-tracked at crvouga/personal commit "
            + manifest["revision"]
        )
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError):
        sys.exit(
            "Git source unavailable or provenance invalid; reinstall from the repository."
        )
