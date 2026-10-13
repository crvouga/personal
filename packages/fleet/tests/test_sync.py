#!/usr/bin/env python3
"""fleet-sync pulls main and switches only when the system is already cached."""

import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "fleet-sync.sh"


def write_executable(path: Path, body: str) -> None:
    path.write_text(textwrap.dedent(body).lstrip("\n"))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.origin = self.root / "origin"
        self.flake = self.origin / "packages" / "fleet"
        self.flake.mkdir(parents=True)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "actions"
        self.nix_log = self.root / "nix-args"
        self.profile = self.root / "profile"
        self.booted = self.root / "booted"
        self.state = self.root / "state"
        self._git(["init", "-b", "main", str(self.origin)])
        self._git(["-C", str(self.origin), "config", "user.email", "test@example.invalid"])
        self._git(["-C", str(self.origin), "config", "user.name", "test"])
        write_executable(self.bin / "nix", f"""\
            #!/bin/bash
            set -euo pipefail
            printf '%s\\n' "$*" >> {self.nix_log}
            jobs=""
            prev=""
            flake=""
            for arg in "$@"; do
              if [ "$prev" = "--max-jobs" ]; then jobs=$arg; fi
              prev=$arg
              case "$arg" in
                path:*) flake=$arg ;;
              esac
            done
            if [ "$jobs" != 0 ]; then
              echo 'local build refused' >&2
              exit 2
            fi
            checkout=''${{flake#path:}}
            checkout=''${{checkout%%#*}}
            if [ -f "$checkout/NOT_IN_CACHE" ]; then
              echo 'not in cache' >&2
              exit 1
            fi
            rev=$(git -C "$checkout" rev-parse HEAD)
            work=$(mktemp -d)
            mkdir -p "$work/bin"
            if [ -f "$checkout/KERNEL_CHANGE" ]; then
              printf 'changed-%s\\n' "$rev" > "$work/kernel-src"
            else
              printf 'same\\n' > "$work/kernel-src"
            fi
            ln -s "$work/kernel-src" "$work/kernel"
            ln -s "$work/kernel-src" "$work/initrd"
            ln -s "$work/kernel-src" "$work/kernel-modules"
            printf '%s\\n' "$rev" > "$work/commit"
            cat > "$work/bin/switch-to-configuration" <<'EOF'
            #!/bin/bash
            printf '%s\\n' "$1" >> {self.log}
            EOF
            chmod +x "$work/bin/switch-to-configuration"
            printf '%s\\n' "$work"
            """)
        write_executable(self.bin / "nix-env", f"""\
            #!/bin/bash
            set -euo pipefail
            prev=""
            profile=""
            target=""
            for arg in "$@"; do
              if [ "$prev" = "-p" ]; then profile=$arg; fi
              if [ "$prev" = "--set" ]; then target=$arg; fi
              prev=$arg
            done
            mkdir -p "$(dirname "$profile")"
            ln -sfn "$target" "$profile"
            """)
        write_executable(self.bin / "systemctl", f"""\
            #!/bin/bash
            if [ "$1" = reboot ]; then printf '%s\\n' reboot >> {self.log}; fi
            exit 0
            """)
        write_executable(self.bin / "drain", f"""\
            #!/bin/bash
            printf '%s\\n' drain >> {self.log}
            if [ -f {self.root}/fail-drain ]; then exit 1; fi
            """)
        write_executable(self.bin / "sleep", f"""\
            #!/bin/bash
            printf '%s\\n' sleep >> {self.log}
            exit 0
            """)
        write_executable(self.bin / "cattle", """\
            #!/bin/bash
            if [ "${1:-}" = print-id ]; then
              if [ -n "${FAIL_ID:-}" ]; then exit 1; fi
              printf '%s\\n' abcd
              exit 0
            fi
            exit 1
            """)
        write_executable(self.bin / "health", f"""\
            #!/bin/bash
            if [ -f {self.root}/fail-health ]; then
              echo 'github unreachable' >&2
              exit 1
            fi
            exit 0
            """)
        self.env = os.environ.copy()
        self.env["PATH"] = f"{self.bin}:{self.env.get('PATH', '')}"
        self.env.update({
            "SYNC_ENV": str(self.root / "sync.env"),
            "STATE_DIR": str(self.state),
            "FLEET_NIX": str(self.bin / "nix"),
            "FLEET_NIX_ENV": str(self.bin / "nix-env"),
            "FLEET_SYSTEMCTL": str(self.bin / "systemctl"),
            "FLEET_GIT": "git",
            "FLEET_PROFILE": str(self.profile),
            "BOOTED_SYSTEM": str(self.booted),
            "PYTHON": "bash",
            "CATTLE_PY": str(self.bin / "cattle"),
            "FLEET_HEALTH": str(self.bin / "health"),
            "FLEET_REPORT": str(self.root / "health-failure"),
            "FAIL_ID": "",
        })
        self.write_env(cache="https://cache.invalid/fleet", delay="0")

    def tearDown(self):
        self.tmp.cleanup()

    def write_env(self, cache, delay, url=None, branch="main"):
        repo = url if url is not None else f"file://{self.origin}"
        text = "\n".join([
            "ROLE=ci",
            "FLAKE_ATTR=ci",
            f"BRANCH={branch}",
            f"REPO_URL={repo}",
            "FLAKE_DIR=packages/fleet",
            f"DELAY_MAX={delay}",
            f"DRAIN_COMMAND={self.bin}/drain",
            "DRAIN_TIMEOUT=5",
            f"CACHE_URL={cache}",
            "GIT_KEY=",
            "GIT_TOKEN=",
            "",
        ])
        (self.root / "sync.env").write_text(text)

    def commit(self, name, body="marker"):
        (self.flake / name).write_text(body)
        self._git(["-C", str(self.origin), "add", "packages"])
        self._git(["-C", str(self.origin), "commit", "-m", name])

    def run_sync(self):
        return subprocess.run(
            ["bash", str(SCRIPT)],
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
        )

    def actions(self):
        if not self.log.exists():
            return []
        return [line for line in self.log.read_text().splitlines() if line]

    def test_unconfigured_repository_does_not_switch(self):
        self.write_env(cache="https://cache.invalid/fleet", delay="0", url="https://github.com/TODO/workspace.git")
        result = self.run_sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.profile.exists())
        self.assertFalse(self.nix_log.exists())

    def test_unconfigured_cache_waits(self):
        self.commit("marker")
        self.write_env(cache="", delay="0")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("binary cache is not configured", result.stderr)
        self.assertFalse(self.profile.exists())
        self.assertFalse(self.nix_log.exists())

    def test_cache_miss_does_not_switch(self):
        self.commit("NOT_IN_CACHE", "")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not building locally", result.stderr)
        self.assertIn("--max-jobs 0", self.nix_log.read_text())
        self.assertFalse(self.profile.exists())
        self.assertEqual(self.actions(), [])

    def test_cache_hit_switches_to_main(self):
        self.commit("marker")
        result = self.run_sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        applied = (self.profile.resolve() / "commit").read_text().strip()
        expected = self._git(["-C", str(self.origin), "rev-parse", "HEAD"]).stdout.strip()
        self.assertEqual(applied, expected)
        self.assertEqual(self.actions(), ["switch"])

    def test_failed_drain_does_not_reboot(self):
        self.commit("marker")
        self.seed_booted()
        (self.flake / "KERNEL_CHANGE").write_text("1")
        self._git(["-C", str(self.origin), "add", "packages"])
        self._git(["-C", str(self.origin), "commit", "-m", "kernel"])
        (self.root / "fail-drain").write_text("1")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.actions(), ["drain"])
        self.assertFalse(any(line == "boot" for line in self.actions()))

    def test_reboot_drains_then_waits(self):
        self.commit("marker")
        self.seed_booted()
        (self.flake / "KERNEL_CHANGE").write_text("1")
        self._git(["-C", str(self.origin), "add", "packages"])
        self._git(["-C", str(self.origin), "commit", "-m", "kernel"])
        self.write_env(cache="https://cache.invalid/fleet", delay="30")
        result = self.run_sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.actions(), ["drain", "sleep", "boot", "reboot"])

    def test_follow_up_commit_switches(self):
        self.commit("first")
        first = self.run_sync()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.commit("second")
        second = self.run_sync()
        self.assertEqual(second.returncode, 0, second.stderr)
        applied = (self.profile.resolve() / "commit").read_text().strip()
        expected = self._git(["-C", str(self.origin), "rev-parse", "HEAD"]).stdout.strip()
        self.assertEqual(applied, expected)
        self.assertEqual(self.actions(), ["switch", "switch"])
        self.assertFalse((self.root / "health-failure").exists())

    def test_health_failure_restores_the_previous_generation(self):
        self.commit("good")
        good = self.run_sync()
        self.assertEqual(good.returncode, 0, good.stderr)
        kept = self.profile.resolve()
        (self.root / "fail-health").write_text("1")
        self.commit("bad")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rolling back", result.stderr)
        self.assertEqual(self.profile.resolve(), kept)
        self.assertNotIn("reboot", self.actions())
        report = (self.root / "health-failure").read_text()
        self.assertIn("github unreachable", report)
        self.assertIn("mode=switch", report)

    def test_reboot_health_failure_does_not_reboot(self):
        self.commit("good")
        good = self.run_sync()
        self.assertEqual(good.returncode, 0, good.stderr)
        kept = self.profile.resolve()
        self.booted.mkdir()
        for name in ("kernel", "initrd", "kernel-modules"):
            (self.booted / name).symlink_to(kept / name)
        self.log.write_text("")
        (self.flake / "KERNEL_CHANGE").write_text("1")
        self._git(["-C", str(self.origin), "add", "packages"])
        self._git(["-C", str(self.origin), "commit", "-m", "kernel"])
        (self.root / "fail-health").write_text("1")
        self.write_env(cache="https://cache.invalid/fleet", delay="30")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rolling back", result.stderr)
        self.assertEqual(self.profile.resolve(), kept)
        self.assertNotIn("reboot", self.actions())
        self.assertEqual(self.actions().count("boot"), 2)
        self.assertIn("drain", self.actions())

    def test_health_failure_without_a_previous_generation_exits(self):
        self.commit("only")
        (self.root / "fail-health").write_text("1")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no previous generation", result.stderr)
        self.assertIn("github unreachable", (self.root / "health-failure").read_text())

    def test_default_probe_rolls_back_when_github_is_down(self):
        self.commit("good")
        good = self.run_sync()
        self.assertEqual(good.returncode, 0, good.stderr)
        kept = self.profile.resolve()
        del self.env["FLEET_HEALTH"]
        write_executable(self.bin / "curl", f"""\
            #!/bin/bash
            url=""
            for arg in "$@"; do url=$arg; done
            printf '%s\\n' "$url" >> {self.root}/curl-urls
            echo 'connection refused' >&2
            exit 1
            """)
        write_executable(self.bin / "systemctl", f"""\
            #!/bin/bash
            if [ "$1" = cat ]; then exit 0; fi
            if [ "$1" = is-failed ]; then
              echo inactive
              exit 1
            fi
            if [ "$1" = reboot ]; then printf '%s\\n' reboot >> {self.log}; fi
            exit 0
            """)
        self.env["FLEET_CURL"] = str(self.bin / "curl")
        self.commit("bad")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.profile.resolve(), kept)
        urls = (self.root / "curl-urls").read_text()
        self.assertIn("https://github.com", urls)
        self.assertNotIn("reboot", self.actions())

    def test_default_probe_fails_when_the_sync_timer_is_failed(self):
        self.commit("good")
        good = self.run_sync()
        self.assertEqual(good.returncode, 0, good.stderr)
        kept = self.profile.resolve()
        del self.env["FLEET_HEALTH"]
        write_executable(self.bin / "curl", """\
            #!/bin/bash
            exit 0
            """)
        write_executable(self.bin / "systemctl", f"""\
            #!/bin/bash
            if [ "$1" = cat ]; then exit 0; fi
            if [ "$1" = is-failed ]; then
              echo failed
              exit 0
            fi
            if [ "$1" = reboot ]; then printf '%s\\n' reboot >> {self.log}; fi
            exit 0
            """)
        self.env["FLEET_CURL"] = str(self.bin / "curl")
        self.commit("bad")
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("fleet-sync.timer is failed", result.stderr)
        self.assertEqual(self.profile.resolve(), kept)

    def test_missing_id_does_not_drain(self):
        self.commit("marker")
        self.seed_booted()
        (self.flake / "KERNEL_CHANGE").write_text("1")
        self._git(["-C", str(self.origin), "add", "packages"])
        self._git(["-C", str(self.origin), "commit", "-m", "kernel"])
        self.write_env(cache="https://cache.invalid/fleet", delay="30")
        self.env["FAIL_ID"] = "1"
        result = self.run_sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not rebooting", result.stderr)
        self.assertEqual(self.actions(), [])

    def seed_booted(self):
        kernel = self.root / "old-kernel"
        kernel.write_text("same")
        self.booted.mkdir()
        for name in ("kernel", "initrd", "kernel-modules"):
            (self.booted / name).symlink_to(kernel)

    def _git(self, args):
        return subprocess.run(["git", *args], check=True, text=True, capture_output=True)


if __name__ == "__main__":
    unittest.main()
