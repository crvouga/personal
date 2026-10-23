#!/usr/bin/env bash
# Validation only. Resource lifecycle operations are exclusively OpenTofu.
set -euo pipefail
cd "$(dirname "$0")"
export TF_VAR_state_passphrase="${TF_VAR_state_passphrase:-validation-only-passphrase-never-used-for-real-state}"
tofu fmt -check -recursive
for root in state foundation bootstrap vault fleet auth auth-hosting auth-development; do
  tofu -chdir="$root" init -backend=false -input=false -lockfile=readonly
  tofu -chdir="$root" validate
done
tofu -chdir=modules/inventory init -backend=false -input=false
tofu -chdir=modules/inventory test
tofu -chdir=modules/railway-service init -backend=false -input=false -lockfile=readonly
tofu -chdir=modules/railway-service test
tofu -chdir=modules/auth-identity-service init -backend=false -input=false -lockfile=readonly
tofu -chdir=modules/auth-identity-service test
tofu -chdir=modules/auth-realm-management init -backend=false -input=false -lockfile=readonly
tofu -chdir=modules/auth-realm-management test

python3 tests/bootstrap.py
python3 tests/railway-settings.py
python3 tests/registry-credentials.py
python3 tests/foundation-controls.py
python3 tests/publisher-handoff.py
python3 tests/foundation.py
python3 tests/vault.py
python3 tests/auth-hosting.py
python3 tests/cloudflare-dns-settings.py
python3 tests/github-secrets.py
python3 tests/domains.py

tofu -chdir=modules/auth-client init -backend=false -input=false -lockfile=readonly
tofu -chdir=modules/auth-client test
bun run --cwd ../../auth-relay test
