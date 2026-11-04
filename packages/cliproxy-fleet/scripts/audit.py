#!/usr/bin/env python3
"""Check installed code against the committed-source installation manifest."""

import hashlib
import json
import os
import pathlib
import sys


def audit(root, check_units=True):
    manifest = json.loads((root / "INSTALLATION.json").read_text())
    errors = []
    for name, expected in {**manifest["files"], **manifest["generated"]}.items():
        path = root / name
        if (
            path.is_symlink()
            or not path.is_file()
            or hashlib.sha256(path.read_bytes()).hexdigest() != expected
        ):
            errors.append(name)
        if check_units and name.startswith("systemd/"):
            unit = pathlib.Path("/etc/systemd/system") / path.name
            if (
                not unit.is_file()
                or hashlib.sha256(unit.read_bytes()).hexdigest() != expected
            ):
                errors.append(str(unit))
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
            print("Installed code differs from source control: " + ", ".join(errors))
            sys.exit(1)
        print("Installed code matches crvouga/personal commit " + manifest["revision"])
    except (OSError, ValueError, KeyError):
        sys.exit(
            "Installation provenance missing or unreadable; reinstall from the repository."
        )
