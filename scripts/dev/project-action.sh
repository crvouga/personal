#!/usr/bin/env bash
# T3 project actions run from this checkout, without a global personal/ws launcher.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
action=${1:-warm}
if [[ $# -gt 0 ]]; then shift; fi
case "$action" in
warm | portfolio | workstation-sync | workstation-update | workstation-net-fix | workstation-net-check | workstation-net-fix-check | fleet-sync | fleet-status | fleet-repair) ;;
*)
  echo "Unknown project action: $action" >&2
  exit 2
  ;;
esac
# The shared owner reuses installed locked tools and converges dependencies.
# Run it on every invocation so branch/toolchain/lock changes cannot leave stale setup.
bash scripts/dev/bootstrap.sh
export PATH="$HOME/.local/bin:$PATH"
run_personal() {
  mise exec -- bun run personal "$@"
}
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
# Fleet and workstation actions are named exactly like the personal command they run.
fleet-sync) run_personal fleet-sync --revision "$(git rev-parse HEAD)" "$@" ;;
fleet-status) run_personal fleet-status --workers "$@" ;;
fleet-repair) run_personal fleet-repair --json "$@" ;;
esac
