#!/usr/bin/env bash
# T3 project actions run from this checkout, without a global personal/ws launcher.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
action=${1:-warm}
case "$action" in
warm | sync | update | net-fix | net-check | net-fix-check | portfolio) ;;
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
sync) run_personal workstation sync ;;
update) run_personal workstation update ;;
net-fix) run_personal workstation net fix ;;
net-check) run_personal workstation net check ;;
net-fix-check)
  run_personal workstation net fix
  run_personal workstation net check
  ;;
portfolio) mise exec -- bun run portfolio ;;
esac
