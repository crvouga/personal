#!/usr/bin/env python3
"""Install only committed package files, preserving cloud-backed runtime state."""

import sys

sys.dont_write_bytecode = True


import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import re
import subprocess
import shutil

PACKAGE = "packages/cliproxy-fleet"
REPOSITORY = "https://github.com/crvouga/personal.git"
LEGACY_FILES = [
    "scripts/tailscale-admin",
    "scripts/install-system",
    "VAULT-REQUEST.md",
    "VERIFICATION.md",
]


def git(repo, *args):
    return subprocess.check_output(
        ["git", "-c", "safe.directory=" + str(repo), "-C", str(repo), *args],
        stderr=subprocess.PIPE,
    )


def source_files(repo, revision):
    commit = git(repo, "rev-parse", "--verify", revision + "^{commit}").decode().strip()
    records = git(repo, "ls-tree", "-rz", commit, "--", PACKAGE).split(b"\0")
    files = {}
    for record in records:
        if not record:
            continue
        metadata, filename = record.split(b"\t", 1)
        mode, kind, _ = metadata.decode().split()
        name = pathlib.PurePosixPath(filename.decode()).relative_to(PACKAGE)
        if kind != "blob" or mode not in ["100644", "100755"] or ".." in name.parts:
            raise ValueError("Package must contain regular tracked files only")
        if name.parts[0] == "state":
            raise ValueError("Runtime state must never be tracked")
        files[str(name)] = (
            0o755 if mode == "100755" else 0o644,
            git(repo, "show", commit + ":" + filename.decode()),
        )
    if "compose.yaml" not in files or "scripts/install.py" not in files:
        raise ValueError("Selected revision does not contain the deployment package")
    return commit, files


def digest(data):
    return hashlib.sha256(data).hexdigest()


def image_environment(files):
    images = json.loads(files["image.lock.json"][1])
    mapping = {
        "CLI_PROXY_IMAGE": images["eceasy/cli-proxy-api"],
        "TAILSCALE_IMAGE": images["tailscale/tailscale"],
        **(
            {"CLOUDFLARED_IMAGE": images["cloudflare/cloudflared"]}
            if "cloudflare/cloudflared" in images
            else {}
        ),
    }
    if not all(
        re.fullmatch(r"[a-z0-9/.-]+@sha256:[0-9a-f]{64}", value)
        for value in mapping.values()
    ):
        raise ValueError("Upstream images must use immutable digests")
    return "".join(
        name + "=" + value + "\n" for name, value in mapping.items()
    ).encode()


def atomic_write(path, data, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".install-new")
    temporary.write_bytes(data)
    temporary.chmod(mode)
    os.replace(temporary, path)


def prepare_source(repo, target, commit):
    worktree = target / "revisions" / commit
    if not worktree.exists():
        worktree.parent.mkdir(parents=True, exist_ok=True)
        git(repo, "worktree", "add", "--detach", str(worktree), commit)
        git(worktree, "sparse-checkout", "set", "--no-cone", "/" + PACKAGE + "/")
    if git(worktree, "rev-parse", "HEAD").decode().strip() != commit:
        raise ValueError("Deployment worktree is at the wrong revision")
    if git(worktree, "status", "--porcelain", "--", PACKAGE).strip():
        raise ValueError("Deployment worktree has local changes")
    # Git creates a private index under sudo; normal users need read-only audits.
    metadata = pathlib.Path(
        git(worktree, "rev-parse", "--absolute-git-dir").decode().strip()
    )
    (metadata / "index").chmod(0o644)
    return worktree


def link_path(path, destination):
    temporary = path.with_name(path.name + ".install-link")
    if temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(destination)
    if path.is_dir() and not path.is_symlink():
        retired = path.with_name(path.name + ".retired-code")
        if retired.exists():
            raise ValueError("Previous retired directory needs review")
        path.rename(retired)
        os.replace(temporary, path)
        shutil.rmtree(retired)
    else:
        os.replace(temporary, path)


def materialize(target, commit, files, worktree):
    target.mkdir(parents=True, exist_ok=True)
    manifest_file = target / "INSTALLATION.json"
    previous = json.loads(manifest_file.read_text()) if manifest_file.exists() else None
    if (
        previous
        and previous.get("schema_version") == 2
        and previous["revision"] != commit
    ):
        atomic_write(
            target / "INSTALLATION.previous.json", manifest_file.read_bytes(), 0o644
        )
    stale = set(previous["files"] if previous else LEGACY_FILES) - set(files)
    # Do not mutate old tracked worktrees through their symlinks.
    for name in stale:
        relative = pathlib.PurePosixPath(name)
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or relative.parts[0] == "state"
        ):
            raise ValueError("Unsafe managed manifest entry")
        if (target / relative.parts[0]).is_symlink():
            continue
        file = target / name
        if file.is_file() or file.is_symlink():
            file.unlink()
    source = worktree / PACKAGE
    for name in sorted({pathlib.PurePosixPath(name).parts[0] for name in files}):
        link_path(target / name, source / name)
    environment = image_environment(files)
    atomic_write(target / ".env", environment, 0o644)
    manifest = {
        "schema_version": 2,
        "repository": REPOSITORY,
        "package": PACKAGE,
        "revision": commit,
        "worktree": str(worktree),
        "files": {name: digest(data) for name, (_, data) in sorted(files.items())},
        "generated": {".env": digest(environment)},
    }
    atomic_write(manifest_file, (json.dumps(manifest, indent=2) + "\n").encode(), 0o644)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[3]
    )
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Materialize committed recovery tooling without initializing state or starting services",
    )
    args = parser.parse_args()
    target = pathlib.Path("/opt/cliproxy-fleet")
    revision = args.revision
    if args.rollback:
        previous = target / "INSTALLATION.previous.json"
        if not previous.exists():
            parser.error("No previous Git installation is recorded")
        previous_metadata = json.loads(previous.read_text())
        if previous_metadata.get("schema_version") != 2:
            parser.error(
                "Legacy copied-code revisions are not eligible for repository-only rollback"
            )
        revision = previous_metadata["revision"]
    commit, files = source_files(args.repo, revision)
    image_environment(files)
    if "clients/launcher.py" not in files:
        parser.error(
            "Choose a revision supporting tracked-code launchers and worktrees"
        )
    if args.dry_run:
        print(
            json.dumps(
                {
                    "repository": REPOSITORY,
                    "revision": commit,
                    "target": str(target),
                    "tracked_files": len(files),
                    "state": "preserved",
                }
            )
        )
        return
    if os.geteuid() != 0:
        parser.error("Run the installation command with sudo")
    if target.is_symlink():
        parser.error("Installation root must not be a symlink")
    for directory in [
        target / "recovery",
        target / "state",
        target / "state/secrets",
        target / "state/status",
    ]:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory.chmod(0o700)
        os.chown(directory, 1000, 1000)
    status = target / "state/status"
    operation_lock = open(status / "operation.lock", "a")
    os.chown(status / "operation.lock", 1000, 1000)
    fcntl.flock(operation_lock, fcntl.LOCK_EX)
    worktree = prepare_source(args.repo, target, commit)
    materialize(target, commit, files, worktree)
    if args.prepare_only:
        print(
            "Prepared committed recovery tooling at "
            + str(target)
            + "; no services started."
        )
        return
    environment = os.environ.copy()
    environment["CLIPROXY_ROOT"] = str(target)
    subprocess.run([str(target / "scripts/initialize")], env=environment, check=True)
    for file in (target / "systemd").iterdir():
        if not file.name.startswith("cliproxy-") or file.suffix not in [
            ".service",
            ".timer",
        ]:
            raise ValueError("Unexpected system unit name")
        link_path(pathlib.Path("/etc/systemd/system") / file.name, file.resolve())
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "docker.service"], check=True)
    subprocess.run(
        [
            "systemctl",
            "enable",
            "cliproxy-fleet.service",
            "cliproxy-monitor.timer",
            "cliproxy-vault-renew.timer",
        ],
        check=True,
    )
    # Startup/stop share the operation lock with checkpoints and recovery.
    fcntl.flock(operation_lock, fcntl.LOCK_UN)
    subprocess.run(["systemctl", "restart", "cliproxy-fleet.service"], check=True)
    subprocess.run(
        ["systemctl", "start", "cliproxy-monitor.timer", "cliproxy-vault-renew.timer"],
        check=True,
    )
    if (target / "state/secrets/recovery-confirmed").exists():
        subprocess.run(
            [
                "systemctl",
                "enable",
                "--now",
                "cliproxy-backup.timer",
                "cliproxy-backup-check.timer",
            ],
            check=True,
        )
    subprocess.run([str(target / "scripts/audit.py")], env=environment, check=True)
    print(
        "Installed committed revision "
        + commit
        + "; existing runtime configuration and credentials preserved."
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(
            "Installation failed: "
            + type(error).__name__
            + "; no secret values printed."
        ) from None
