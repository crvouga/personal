#!/usr/bin/env python3
"""fleet-install runs on the machine. It does not read a work-computer key."""

import os
import pty
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "fleet-install.sh"


def write_executable(path: Path, body: str) -> None:
    path.write_text(textwrap.dedent(body).lstrip("\n"))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "actions"
        self.mnt = self.root / "mnt"
        self.recorded = self.root / "recorded"
        self.system = self.root / "systems" / "ci"
        self.system.mkdir(parents=True)
        self.disko = self.root / "disko"
        write_executable(self.disko, f"""\
            #!/bin/bash
            printf 'disko %s\\n' "$(cat {self.recorded})" >> {self.log}
            mkdir -p {self.mnt}/nix/fleet-state
            """)
        write_executable(self.bin / "select-disk", f"""\
            #!/bin/bash
            printf 'select\\n' >> {self.log}
            cat {self.root}/disk
            """)
        write_executable(self.bin / "age-keygen", f"""\
            #!/bin/bash
            printf 'age %s\\n' "$*" >> {self.log}
            if [ "$1" = "-y" ]; then
              echo age1publicstub
              exit 0
            fi
            printf 'AGE-SECRET-KEY-STUB\\n' > "$2"
            """)
        write_executable(self.bin / "ssh-keygen", f"""\
            #!/bin/bash
            printf 'ssh-keygen %s\\n' "$*" >> {self.log}
            if [ "$1" = "-lf" ]; then
              echo "256 SHA256:stub $2"
              exit 0
            fi
            prev=""
            file=""
            for arg in "$@"; do
              if [ "$prev" = "-f" ]; then file=$arg; fi
              prev=$arg
            done
            printf 'priv\\n' > "$file"
            printf 'pub\\n' > "$file.pub"
            """)
        write_executable(self.bin / "nixos-install", f"""\
            #!/bin/bash
            printf 'install %s\\n' "$*" >> {self.log}
            """)
        (self.root / "disk").write_text("/dev/disk/by-path/pci-0000:01:00.0-nvme-1\n")
        manifest = self.root / "manifest"
        manifest.write_text(f"ci {self.system}\ndisko {self.disko}\n")
        self.manifest = manifest
        self.env = os.environ.copy()
        self.env.update({
            "PATH": f"{self.bin}:{os.environ.get('PATH', '')}",
            "FLEET_ALLOW_UNPRIVILEGED": "1",
            "FLEET_MANIFEST": str(manifest),
            "FLEET_MNT": str(self.mnt),
            "FLEET_RECORDED": str(self.recorded),
            "FLEET_SELECT_DISK": str(self.bin / "select-disk"),
            "FLEET_AGE_KEYGEN": str(self.bin / "age-keygen"),
            "FLEET_SSH_KEYGEN": str(self.bin / "ssh-keygen"),
            "FLEET_NIXOS_INSTALL": str(self.bin / "nixos-install"),
        })
        self.env.pop("FLEET_KEY_DIR", None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_tty(self, args, typed, env=None):
        master, slave = pty.openpty()
        proc = subprocess.Popen(
            [str(SCRIPT), *args],
            stdin=slave,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env or self.env,
        )
        os.close(slave)
        os.write(master, typed.encode())
        try:
            out, err = proc.communicate(timeout=15)
        finally:
            os.close(master)
        return proc.returncode, out.decode(), err.decode()

    def test_missing_manifest_does_not_touch_a_disk(self):
        env = self.env.copy()
        env["FLEET_MANIFEST"] = str(self.root / "missing")
        result = subprocess.run(
            [str(SCRIPT), "ci"],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("USB image", result.stderr)
        self.assertFalse(self.log.exists())

    def test_gpu_role_is_not_on_the_image(self):
        result = subprocess.run(
            [str(SCRIPT), "ci-gpu"],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.log.exists())

    def test_auto_wipes_without_typing_the_path(self):
        env = self.env.copy()
        env["FLEET_AUTO"] = "1"
        result = subprocess.run(
            [str(SCRIPT), "ci"],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        disk = "/dev/disk/by-path/pci-0000:01:00.0-nvme-1"
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"disko {disk}", self.log.read_text())
        self.assertIn("Wiping that disk", result.stderr)
        self.assertNotIn("AGE-SECRET-KEY-STUB", result.stderr)

    def test_cmdline_role_uses_the_last_value(self):
        cmdline = self.root / "cmdline"
        cmdline.write_text("root=LABEL=nixos fleet.role=ci fleet.role=web\n")
        web = self.root / "systems" / "web"
        web.mkdir()
        self.manifest.write_text(
            f"ci {self.system}\nweb {web}\ndisko {self.disko}\n"
        )
        env = self.env.copy()
        env["FLEET_AUTO"] = "1"
        env["FLEET_CMDLINE"] = str(cmdline)
        result = subprocess.run(
            [str(SCRIPT)],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"install --no-root-passwd --root {self.mnt} --system {web}", self.log.read_text())
        self.assertIn("Role: web", result.stderr)

    def test_non_tty_refuses_before_disko(self):
        result = subprocess.run(
            [str(SCRIPT), "ci"],
            input="/dev/disk/by-path/pci-0000:01:00.0-nvme-1\n",
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("without a terminal", result.stderr)
        self.assertFalse(self.log.exists() and "disko " in self.log.read_text())

    def test_wrong_path_does_not_wipe(self):
        code, _out, err = self.run_tty(["ci"], "nope\n")
        self.assertEqual(code, 1)
        self.assertIn("did not match", err)
        self.assertNotIn("disko ", self.log.read_text())

    def test_install_generates_a_key_and_does_not_print_it(self):
        disk = "/dev/disk/by-path/pci-0000:01:00.0-nvme-1"
        code, _out, err = self.run_tty(["ci"], disk + "\n")
        self.assertEqual(code, 0, err)
        actions = self.log.read_text()
        self.assertIn(f"disko {disk}", actions)
        self.assertIn(f"install --no-root-passwd --root {self.mnt} --system {self.system}", actions)
        secret = (self.mnt / "nix/fleet-state/secrets/age.key").read_text()
        self.assertEqual(secret, "AGE-SECRET-KEY-STUB\n")
        self.assertEqual((self.mnt / "nix/fleet-state/secrets/age.pub").read_text(), "age1publicstub\n")
        self.assertIn("age1publicstub", err)
        self.assertNotIn("AGE-SECRET-KEY-STUB", err)
        self.assertTrue((self.mnt / "nix/fleet-state/ssh/ssh_host_ed25519_key").is_file())
        self.assertIn("Remove the USB", err)

    def test_existing_stick_key_is_reused(self):
        stick = self.root / "stick"
        stick.mkdir()
        (stick / "ci.age").write_text("FROM-STICK\n")
        env = self.env.copy()
        env["FLEET_KEY_DIR"] = str(stick)
        disk = "/dev/disk/by-path/pci-0000:01:00.0-nvme-1"
        code, _out, err = self.run_tty(["ci"], disk + "\n", env)
        self.assertEqual(code, 0, err)
        self.assertEqual((self.mnt / "nix/fleet-state/secrets/age.key").read_text(), "FROM-STICK\n")
        self.assertNotIn("age -o", self.log.read_text())

    def test_new_key_is_copied_to_an_empty_stick(self):
        stick = self.root / "stick"
        stick.mkdir()
        env = self.env.copy()
        env["FLEET_KEY_DIR"] = str(stick)
        disk = "/dev/disk/by-path/pci-0000:01:00.0-nvme-1"
        code, _out, err = self.run_tty(["ci"], disk + "\n", env)
        self.assertEqual(code, 0, err)
        self.assertEqual((stick / "ci.age").read_text(), "AGE-SECRET-KEY-STUB\n")
        self.assertNotIn("AGE-SECRET-KEY-STUB", err)

    def test_identical_role_keys_are_refused(self):
        stick = self.root / "stick"
        stick.mkdir()
        (stick / "ci.age").write_text("SAME\n")
        (stick / "web.age").write_text("SAME\n")
        env = self.env.copy()
        env["FLEET_KEY_DIR"] = str(stick)
        result = subprocess.run(
            [str(SCRIPT), "web"],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("must differ", result.stderr)
        self.assertFalse(self.log.exists())

    def test_changed_disk_selection_aborts(self):
        write_executable(self.bin / "select-disk", f"""\
            #!/bin/bash
            n=0
            if [ -f {self.root}/selects ]; then n=$(cat {self.root}/selects); fi
            n=$((n + 1))
            printf '%s\\n' "$n" > {self.root}/selects
            if [ "$n" -eq 1 ]; then
              echo /dev/disk/by-path/pci-0000:01:00.0-nvme-1
            else
              echo /dev/disk/by-path/pci-0000:02:00.0-nvme-1
            fi
            """)
        result = subprocess.run(
            [str(SCRIPT), "ci"],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("Disk selection changed", result.stderr)
        self.assertFalse(self.log.exists())
