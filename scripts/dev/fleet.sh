#!/bin/sh
# Runs a dev-fleet command at the pinned revision (fleet.revision) with this
# repository's fleet.json. The fleet code lives in the repository that
# fleet.json names under source.repository; nothing of it is copied here.
# The pin is a commit, not the npm version dev-fleet documents, until a release
# names its commit: https://github.com/crvouga/dev-fleet/issues/17
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
# Every other command runs from a checkout of the pinned revision that
# fleet-sync prepared: the manager's run checkout, or the one applied on a worker.
fleet="$HOME/.local/share/personal/fleet"
checkout=''
for candidate in "$fleet/manager-runs/$revision" "$fleet/revisions/$revision"; do
  if [ -d "$candidate/node_modules" ]; then
    checkout=$candidate
    break
  fi
done
[ -n "$checkout" ] || { echo "This machine has no dev-fleet checkout at $revision. Run fleet-sync first; it prepares one." >&2; exit 3; }
cd "$checkout"
export PERSONAL_WORKSPACE="$checkout"
exec mise exec --locked bun -- bun src/cli/cli.ts "$command" "$@"
