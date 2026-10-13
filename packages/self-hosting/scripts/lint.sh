#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for script in scripts/*.sh; do bash -n "$script"; done
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck scripts/*.sh
else
  echo 'ShellCheck unavailable; shell syntax checks still run'
fi
cmp workflows/runner-check.yml ../../.github/workflows/runner-check.yml
if command -v actionlint >/dev/null 2>&1; then
  actionlint -config-file actionlint.yaml workflows/*.yml ../../.github/workflows/runner-check.yml
else
  echo 'actionlint unavailable; run the pinned Nix devShell checks on Linux'
fi
python3 - <<'CHECK'
import json
from pathlib import Path
lock = json.loads(Path('flake.lock').read_text())
for name in ('nixpkgs', 'disko', 'sops-nix'):
    pinned = lock['nodes'][name]['locked']
    assert len(pinned['rev']) == 40 and pinned['narHash'].startswith('sha256-')
assert not list(Path('secrets').glob('*.key'))
assert not list(Path('secrets').glob('*.pem'))
CHECK
