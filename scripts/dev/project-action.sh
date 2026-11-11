#!/usr/bin/env bash
# T3 project actions run from this checkout, without a global personal/ws launcher.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
action=${1:-warm}
if [[ $# -gt 0 ]]; then shift; fi
case "$action" in
warm | portfolio | workstation-sync | workstation-update | workstation-net-fix | workstation-net-check | workstation-net-fix-check | fleet-sync | fleet-preview | fleet-status | fleet-health | fleet-repair | fleet-t3-status | infra-cliproxy) ;;
*)
  echo "Unknown project action: $action" >&2
  exit 2
  ;;
esac
export PATH="$HOME/.local/bin:$PATH"
# Fleet actions run dev-fleet at the pinned revision (fleet.revision) with fleet.json.
# They need no setup from this checkout: dev-fleet installs its own pinned toolchain
# on the machines it manages, and this repository's bootstrap must not replace it.
case "$action" in
fleet-sync) exec sh scripts/dev/fleet.sh fleet-sync "$@" ;;
fleet-preview) exec sh scripts/dev/fleet.sh fleet-sync --dry-run "$@" ;;
fleet-status) exec sh scripts/dev/fleet.sh fleet-status --workers "$@" ;;
fleet-health) exec sh scripts/dev/fleet-health.sh "$@" ;;
fleet-repair) exec sh scripts/dev/fleet.sh fleet-repair --json "$@" ;;
fleet-t3-status) exec sh scripts/dev/fleet.sh t3-status "$@" ;;
# Arguments choose the operation, for example `model-health`, `model-suite --target mock`, `status`.
infra-cliproxy) exec sh scripts/dev/fleet.sh cliproxy "$@" ;;
esac
# The shared owner reuses installed locked tools and converges dependencies.
# Run it on every invocation so branch/toolchain/lock changes cannot leave stale setup.
bash scripts/dev/bootstrap.sh
run_personal() {
  mise exec -- bun run personal "$@"
}
# Workstation actions are named exactly like the personal command they run.
case "$action" in
warm) ;;
workstation-sync) run_personal workstation sync --yes ;;
workstation-update) run_personal workstation update --yes ;;
workstation-net-fix) run_personal workstation net fix --yes ;;
workstation-net-check) run_personal workstation net check ;;
workstation-net-fix-check)
  run_personal workstation net fix --yes
  run_personal workstation net check
  ;;
portfolio) mise exec -- bun run portfolio ;;
esac
