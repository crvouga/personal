#!/usr/bin/env python3
"""The live image installs itself. A boot with no payload does not wipe."""

import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "fleet-auto.sh"


def write_executable(path: Path, body: str) -> None:
    path.write_text(textwrap.dedent(body).lstrip("\n"))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class AutoInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.log = self.root / "install"
        self.install = self.root / "fleet-install"
        write_executable(self.install, f"""\
            #!/bin/bash
            printf 'auto=%s args=%s\\n' "$FLEET_AUTO" "$*" > {self.log}
            """)
        self.env = os.environ.copy()
        self.env.update({
            "FLEET_ALLOW_UNPRIVILEGED": "1",
            "FLEET_SKIP_REBOOT": "1",
            "FLEET_INSTALL": str(self.install),
        })

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_manifest_does_not_install(self):
        env = self.env.copy()
        env["FLEET_MANIFEST"] = str(self.root / "missing")
        result = subprocess.run(
            [str(SCRIPT)],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("disk was not changed", result.stderr)
        self.assertFalse(self.log.exists())

    def test_manifest_runs_install_and_does_not_reboot(self):
        manifest = self.root / "manifest"
        manifest.write_text("ci /system\n")
        env = self.env.copy()
        env["FLEET_MANIFEST"] = str(manifest)
        result = subprocess.run(
            [str(SCRIPT)],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text(), "auto=1 args=\n")
        self.assertIn("pull the stick", result.stderr)
