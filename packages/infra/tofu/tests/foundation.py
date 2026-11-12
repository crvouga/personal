"""Plan foundation with real provider schemas and mocked cloud responses."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

tofu_root = Path(__file__).resolve().parents[1]
packages = tofu_root.parents[1]
env = dict(os.environ)
env.setdefault("TF_VAR_state_passphrase", "validation-only-passphrase-never-used-for-real-state")
tests = tofu_root / "tests/foundation.tftest.hcl"
# Runs before the first run block: mock providers, overrides and variables.
shared = tests.read_text().split('\nrun "', 1)[0]


def plan(directory, test, live=False):
    # Mirror sibling packages so the authentication relay schema resolves.
    mirror = Path(directory) / "packages"
    root = mirror / "infra/tofu/foundation"
    root.mkdir(parents=True)
    modules = root.parent / "modules"
    if live:
        # Copy the modules so only this plan sees observability.live = true.
        shutil.copytree(tofu_root / "modules", modules)
        inventory = modules / "inventory/inventory.tf.json"
        document = json.loads(inventory.read_text())
        document["locals"]["inventory"]["observability"]["live"] = True
        inventory.write_text(json.dumps(document))
    else:
        modules.symlink_to(tofu_root / "modules", target_is_directory=True)
    (mirror / "auth-relay").symlink_to(packages / "auth-relay", target_is_directory=True)
    for source in (tofu_root / "foundation").glob("*.tf"):
        # OpenTofu 1.13's mock providers panic on ImportResourceState. Only the
        # isolated test copy omits import blocks; production adoption retains them.
        text = re.sub(r"(?ms)^import \{\n.*?^\}\n", "", source.read_text())
        (root / source.name).write_text(text)
    for name in ["variables.tf.json", ".terraform.lock.hcl"]:
        shutil.copyfile(tofu_root / "foundation" / name, root / name)
    (root / "foundation.tftest.hcl").write_text(test)
    for args in [("init", "-backend=false", "-input=false", "-lockfile=readonly"), ("test", "-no-color")]:
        result = subprocess.run(
            [shutil.which("tofu"), "-chdir=" + str(root), *args],
            env=env, capture_output=True, text=True,
        )
        if result.returncode:
            raise RuntimeError(result.stdout[-6000:] + result.stderr[-6000:])
    print("\n".join(line for line in result.stdout.splitlines()
                    if line.startswith("foundation.tftest.hcl") or line.startswith("  run ")
                    or line.startswith("Success!")))


with tempfile.TemporaryDirectory(prefix="workspace-tofu-foundation-") as directory:
    plan(directory, tests.read_text())
with tempfile.TemporaryDirectory(prefix="workspace-tofu-foundation-live-") as directory:
    plan(directory, shared + "\n" + (tofu_root / "tests/foundation-observability.tftest.hcl").read_text(), live=True)
