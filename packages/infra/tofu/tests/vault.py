"""Plan the vault root with real provider schemas and mocked Vault responses."""

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

with tempfile.TemporaryDirectory(prefix="workspace-tofu-vault-") as directory:
    # Mirror the repository layout: policies are read from packages/vault-service.
    mirror = Path(directory) / "packages"
    root = mirror / "infra/tofu/vault"
    root.mkdir(parents=True)
    (root.parent / "modules").symlink_to(tofu_root / "modules", target_is_directory=True)
    (mirror / "vault-service").symlink_to(packages / "vault-service", target_is_directory=True)
    for source in (tofu_root / "vault").glob("*.tf"):
        # OpenTofu 1.13's mock providers panic on ImportResourceState; only this
        # isolated copy omits import blocks.
        text = re.sub(r"(?ms)^import \{\n.*?^\}\n", "", source.read_text())
        (root / source.name).write_text(text)
    for name in ["variables.tf.json", ".terraform.lock.hcl"]:
        shutil.copyfile(tofu_root / "vault" / name, root / name)
    shutil.copyfile(tofu_root / "tests/vault.tftest.hcl", root / "vault.tftest.hcl")
    for args in [("init", "-backend=false", "-input=false", "-lockfile=readonly"), ("test", "-no-color")]:
        result = subprocess.run(
            [shutil.which("tofu"), "-chdir=" + str(root), *args],
            env=env, capture_output=True, text=True,
        )
        if result.returncode:
            raise RuntimeError(result.stdout[-6000:] + result.stderr[-6000:])
    print("\n".join(line for line in result.stdout.splitlines()
                    if line.startswith("vault.tftest.hcl") or line.startswith("  run ")
                    or line.startswith("Success!")))
