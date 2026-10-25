#!/usr/bin/env bash
# Validation only. Resource lifecycle operations are exclusively OpenTofu.
# CI distributes these groups across runners; no argument still runs them all.
set -euo pipefail
cd "$(dirname "$0")"
export TF_VAR_state_passphrase="${TF_VAR_state_passphrase:-validation-only-passphrase-never-used-for-real-state}"
group="${1:-all}"
case "$group" in all|validate|modules|contracts) ;; *) echo "Unknown check group: $group" >&2; exit 2 ;; esac

if [[ "$group" = all || "$group" = validate ]]; then
  tofu fmt -check -recursive
  for root in state foundation bootstrap vault fleet auth auth-hosting auth-development signing; do
    tofu -chdir="$root" init -backend=false -input=false -lockfile=readonly
    tofu -chdir="$root" validate
  done
fi

if [[ "$group" = all || "$group" = modules ]]; then
  tofu -chdir=modules/inventory init -backend=false -input=false
  tofu -chdir=modules/inventory test
  tofu -chdir=signing init -backend=false -input=false -lockfile=readonly
  tofu -chdir=signing test
  for module in railway-service auth-identity-service auth-realm-management auth-client; do
    tofu -chdir="modules/$module" init -backend=false -input=false -lockfile=readonly
    tofu -chdir="modules/$module" test
  done
fi

if [[ "$group" = all || "$group" = contracts ]]; then
  python3 tests/run-contracts.py bootstrap railway-settings registry-credentials foundation-controls publisher-handoff foundation vault auth-hosting cloudflare-dns-settings github-secrets domains aliases
  bun run --cwd ../../auth-relay test
fi
