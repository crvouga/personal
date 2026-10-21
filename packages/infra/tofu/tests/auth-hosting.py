"""Plan the auth-hosting root with real provider schemas and mocked providers."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile

tofu_root = Path(__file__).resolve().parents[1]
env = dict(os.environ)
env.setdefault("TF_VAR_state_passphrase", "validation-only-passphrase-never-used-for-real-state")

with tempfile.TemporaryDirectory(prefix="workspace-tofu-auth-hosting-") as directory:
    root = Path(directory) / "packages/infra/tofu/auth-hosting"
    root.mkdir(parents=True)
    (root.parent / "modules").symlink_to(tofu_root / "modules", target_is_directory=True)
    for source in (tofu_root / "auth-hosting").iterdir():
        if source.is_file():
            shutil.copyfile(source, root / source.name)
    shutil.copyfile(tofu_root / "tests/auth-hosting.tftest.hcl", root / "auth-hosting.tftest.hcl")
    for args in [("init", "-backend=false", "-input=false", "-lockfile=readonly"), ("test", "-no-color")]:
        result = subprocess.run(
            [shutil.which("tofu"), "-chdir=" + str(root), *args],
            env=env, capture_output=True, text=True,
        )
        if result.returncode:
            raise RuntimeError(result.stdout[-6000:] + result.stderr[-6000:])
    print("\n".join(line for line in result.stdout.splitlines()
                    if line.startswith("auth-hosting.tftest.hcl") or line.startswith("  run ")
                    or line.startswith("Success!")))
