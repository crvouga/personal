#!/bin/sh
# Runs a dev-fleet command at the pinned revision (fleet.revision) with this
# repository's fleet.json. The fleet code lives in the repository that
# fleet.json names under source.repository; nothing of it is copied here.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
revision=$(tr -d '[:space:]' <"$root/fleet.revision")
case "$revision" in *[!a-f0-9]*|'') echo 'fleet.revision must hold a full commit SHA.' >&2; exit 2;; esac
[ "${#revision}" = 40 ] || { echo 'fleet.revision must hold a full commit SHA.' >&2; exit 2; }
repository=$(sed -n 's/.*"repository": *"\([^"]*\)".*/\1/p' "$root/fleet.json" | head -n 1)
[ -n "$repository" ] || { echo 'fleet.json names no source.repository.' >&2; exit 2; }
source="$HOME/.local/share/dev-fleet/source"
if [ ! -d "$source/.git" ]; then
  mkdir -p "$(dirname "$source")"
  git clone --quiet "$repository" "$source"
fi
git -C "$source" cat-file -e "$revision^{commit}" 2>/dev/null || git -C "$source" fetch --quiet origin
git -C "$source" cat-file -e "$revision^{commit}" 2>/dev/null || { echo "dev-fleet revision $revision is not in $repository." >&2; exit 4; }
export DEVFLEET_REPO="$source" DEVFLEET_CONFIG="$root/fleet.json"
command=${1:?Usage: fleet.sh COMMAND [ARGS]}
shift
if [ "$command" = fleet-sync ]; then
  # The manager entry point: a clean checkout of the pinned revision.
  exec sh -c "$(git -C "$source" show "$revision:bootstrap/fleet-manager-run.sh")" fleet-manager-run "$revision" "$@"
fi
# Every other command runs from the checkout fleet-sync prepared.
checkout="$HOME/.local/share/personal/fleet/manager-runs/$revision"
[ -d "$checkout/node_modules" ] || { echo 'Run fleet-sync once at this revision first; it prepares the checkout.' >&2; exit 3; }
cd "$checkout"
export PERSONAL_WORKSPACE="$checkout"
exec mise exec --locked bun -- bun src/cli/cli.ts "$command" "$@"
