"""Plan foundation with real provider schemas and mocked cloud responses."""

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

with tempfile.TemporaryDirectory(prefix="workspace-tofu-foundation-") as directory:
    # Mirror packages/infra/tofu/foundation so relative paths into sibling
    # packages (fleet-api/schema.hcl) resolve exactly as they do in production.
    mirror = Path(directory) / "packages"
    root = mirror / "infra/tofu/foundation"
    root.mkdir(parents=True)
    (root.parent / "modules").symlink_to(tofu_root / "modules", target_is_directory=True)
    (mirror.parent / "vendor").symlink_to(packages.parent / "vendor", target_is_directory=True)
    (mirror / "auth-relay").symlink_to(packages / "auth-relay", target_is_directory=True)
    for source in (tofu_root / "foundation").glob("*.tf"):
        # OpenTofu 1.13's mock providers panic on ImportResourceState. Only the
        # isolated test copy omits import blocks; production adoption retains them.
        text = re.sub(r"(?ms)^import \{\n.*?^\}\n", "", source.read_text())
        (root / source.name).write_text(text)
    for name in ["variables.tf.json", ".terraform.lock.hcl"]:
        shutil.copyfile(tofu_root / "foundation" / name, root / name)
    shutil.copyfile(tofu_root / "tests/foundation.tftest.hcl", root / "foundation.tftest.hcl")
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
