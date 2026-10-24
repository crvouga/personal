#!/usr/bin/env python3
"""Run independent installer contracts concurrently on each native platform."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import argparse
import os
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def commands(version, native_nix=False):
    checks = {
        "Wizard unit tests": [sys.executable, "-B", "tests/run.py", "--pattern", "test_wizard*.py"],
        "Wizard browser contracts": ["node", "wizard/ui-e2e.cjs"],
        "Packaged installer and self-test": [sys.executable, "wizard/build.py", "--version", version],
    }
    if sys.platform == "win32":
        checks["Windows release trust contracts"] = [sys.executable, "-B", "tests/run.py", "--pattern", "test_windows_signing.py"]
    if native_nix:
        checks["Native Nix installer"] = ["nix", "build", "--no-write-lock-file", "-o", "result-native", ".#fleet-installer"]
    return checks


def execute(command, directory):
    # The contracts inspect their temporary request files. Sharing an OS temp
    # directory would make simultaneous, otherwise isolated checks interfere.
    with tempfile.TemporaryDirectory(prefix="fleet-installer-check-") as temporary:
        env = {**os.environ, "TMPDIR": temporary, "TEMP": temporary, "TMP": temporary}
        return subprocess.run(command, cwd=directory, env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True)


def run_checks(checks, directory):
    failed = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {
            pool.submit(execute, command, directory): name
            for name, command in checks.items()
        }
        for future in as_completed(pending):
            name = pending[future]
            try:
                result = future.result()
                print(f"\n--- {name} ---\n{result.stdout}", flush=True)
                if result.returncode:
                    failed.append(name)
            except OSError as error:
                print(f"{name}: {error}", file=sys.stderr, flush=True)
                failed.append(name)
    if failed:
        print(f"FAILED installer checks: {', '.join(sorted(failed))}", file=sys.stderr, flush=True)
    return int(bool(failed))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--native-nix", action="store_true")
    args = parser.parse_args()
    return run_checks(commands(args.version, args.native_nix), ROOT)


if __name__ == "__main__":
    sys.exit(main())
