"""Consistent, secret-minimal checkpoints. Runtime state is never executable code."""

import hashlib
import json
import os
import pathlib
import shutil
import stat
import subprocess

STATE_PATHS = (
    "runtime/config.yaml",
    "runtime/auths",
    "runtime/static/management.html",
    "tailscale",
    "endpoint.json",
    "public-endpoint-enabled",
    "repository.json",
)


def regular_tree(path):
    """Reject links/devices before copying or publishing recovered state."""
    mode = path.lstat().st_mode
    if stat.S_ISDIR(mode):
        for child in path.iterdir():
            regular_tree(child)
    elif not stat.S_ISREG(mode):
        raise ValueError("Checkpoint must contain only regular files/directories")


def hashes(root):
    regular_tree(root)
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file() and path != root / "CHECKPOINT.json"
    }


def validate(root):
    regular_tree(root)
    manifest = json.loads((root / "CHECKPOINT.json").read_text())
    if manifest.get("version") != 1 or manifest.get("files") != hashes(root):
        raise ValueError("Checkpoint incomplete or changed")
    state = root / "state"
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        name = str(path.relative_to(root))
        if name in ("CHECKPOINT.json", "INSTALLATION.json"):
            continue
        if not any(
            name == "state/" + allowed or name.startswith("state/" + allowed + "/")
            for allowed in STATE_PATHS
        ):
            raise ValueError("Unexpected checkpoint file")
    if not (state / "runtime/static/management.html").is_file():
        raise ValueError("Dashboard missing")
    if not (state / "runtime/auths").is_dir():
        raise ValueError("Provider cache directory missing")
    for path in (state / "runtime/auths").iterdir():
        if path.name == "kv.db" and path.is_file() and path.stat().st_size > 0:
            continue  # Opaque upstream bbolt state, captured while the process is stopped.
        if path.suffix != ".json" or not path.is_file():
            raise ValueError("Unexpected provider file")
        if not isinstance(json.loads(path.read_text()), dict):
            raise ValueError("Provider credential must be an object")
    subprocess.run(
        [
            str(pathlib.Path(__file__).parent / "validate-config"),
            str(state / "runtime/config.yaml"),
        ],
        check=True,
        capture_output=True,
    )
    return manifest


def capture(root, target, compose):
    """Always resume the originally running services before cloud I/O."""
    running = compose(
        "ps", "--status", "running", "--services", capture_output=True
    ).stdout.split()
    try:
        if running:
            compose("stop", *running)
        target.mkdir(mode=0o700)
        (target / "state").mkdir(mode=0o700)
        for name in STATE_PATHS:
            source = root / "state" / name
            if not source.exists() and not source.is_symlink():
                continue
            regular_tree(source)
            destination = target / "state" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                # Runtime file locks are process-local and must not be restored.
                ignore = (
                    shutil.ignore_patterns("*.lock")
                    if name == "runtime/auths"
                    else None
                )
                shutil.copytree(source, destination, ignore=ignore)
            else:
                shutil.copyfile(source, destination)
        shutil.copyfile(root / "INSTALLATION.json", target / "INSTALLATION.json")
        (target / "CHECKPOINT.json").write_text(
            json.dumps({"version": 1, "files": hashes(target)}) + "\n"
        )
        validate(target)
    finally:
        if running:
            compose(
                "--profile",
                "portable-endpoint",
                "--profile",
                "public-endpoint",
                "start",
                *running,
            )


def locate(restored):
    """Restic retains the source absolute path; never assume a source hostname/path."""
    candidates = list(restored.rglob("CHECKPOINT.json"))
    if len(candidates) != 1:
        raise ValueError(
            "Expected exactly one modern checkpoint; use manual legacy recovery"
        )
    root = candidates[0].parent
    validate(root)
    return root


def hydrate(checkpoint, state):
    """Populate an empty cache only. A crash marker prevents partial-cache startup."""
    validate(checkpoint)
    names = (
        "runtime",
        "tailscale",
        "endpoint.json",
        "public-endpoint-enabled",
        "repository.json",
    )
    repository = state / "repository.json"
    if repository.exists() or repository.is_symlink():
        regular_tree(repository)
        saved = checkpoint / "state/repository.json"
        if not saved.is_file() or json.loads(repository.read_text()) != json.loads(
            saved.read_text()
        ):
            raise ValueError("Existing repository identity differs from checkpoint")
        names = tuple(name for name in names if name != "repository.json")
    if any((state / name).exists() or (state / name).is_symlink() for name in names):
        raise ValueError(
            "Recovery requires an empty cache; preserve or remove existing cache explicitly"
        )
    marker = state / "recovery-incomplete"
    if marker.exists():
        raise ValueError("Interrupted recovery requires inspection")
    marker.write_text("Recovery in progress; do not start services.\n")
    created = []
    try:
        for name in names:
            source = checkpoint / "state" / name
            if not source.exists():
                continue
            destination = state / name
            created.append(destination)
            if source.is_dir():
                shutil.copytree(source, destination)
            else:
                shutil.copyfile(source, destination)
            paths = (
                [destination, *destination.rglob("*")]
                if destination.is_dir()
                else [destination]
            )
            for path in paths:
                path.chmod(0o700 if path.is_dir() else 0o600)
                if os.geteuid() == 0:
                    os.chown(path, 1000, 1000)
        marker.unlink()
    except BaseException:
        for destination in reversed(created):
            if destination.is_dir():
                shutil.rmtree(destination)
            else:
                destination.unlink(missing_ok=True)
        marker.unlink()
        raise
