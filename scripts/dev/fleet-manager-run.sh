#!/bin/sh
# Every fleet-sync on the manager runs through this, whether started there or
# handed off from a worker over strict SSH. Runs fleet-sync from a clean,
# fleet-owned checkout of the exact approved revision, so the result never
# depends on the working tree it was started in (uncommitted edits, another
# branch, a removed worktree). Checkouts are reused when warm and pruned to the
# three most recent plus the one T3's providers launch from. Never touches the
# human's working tree.
set -eu
revision=$1
shift
case "$revision" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#revision}" = 40 ] || exit 2
say() { printf 'fleet-sync (manager): %s\n' "$1" >&2; }
launcher=$(command -v personal) || { say 'the personal launcher is not installed; run bun run personal:install on the manager.'; exit 3; }
repo=$(git -C "$(dirname "$(readlink -f "$launcher")")" rev-parse --show-toplevel) || { say 'cannot locate the manager checkout.'; exit 3; }
runs="$HOME/.local/share/personal/fleet/manager-runs"
dir="$runs/$revision"
ready() {
  [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$revision" ] &&
    [ -z "$(git -C "$dir" status --porcelain 2>/dev/null)" ]
}
if ! ready; then
  git -C "$repo" cat-file -e "$revision^{commit}" 2>/dev/null || git -C "$repo" fetch --quiet origin || true
  git -C "$repo" cat-file -e "$revision^{commit}" 2>/dev/null || { say "revision $revision is neither on the manager nor on origin; push it first."; exit 4; }
  mkdir -p "$runs"
  chmod 700 "$runs"
  # A fleet-owned, disposable run checkout: recreate it when stale or dirty.
  if [ -e "$dir" ]; then git -C "$repo" worktree remove --force "$dir" 2>/dev/null || rm -rf -- "$dir"; fi
  rm -f -- "$runs/$revision.ready"
  git -C "$repo" worktree prune
  git -C "$repo" worktree add --quiet --detach "$dir" "$revision"
fi
touch "$dir"
cd "$dir"
mise trust --quiet "$dir/mise.toml" >/dev/null 2>&1 || true
# The manager runs the same locked toolchain (and so the same agent versions)
# as every worker: publish this revision's global config, install it and the
# frozen dependencies. Warm: skipped when this checkout did it within a day.
# Stamp and log sit beside the checkout: inside it they would make it dirty.
stamp="$runs/$revision.ready"
log="$runs/$revision.setup.log"
if [ -z "$(find "$stamp" -mmin -1440 2>/dev/null)" ]; then
  rm -f -- "$stamp"
  if ! { mise exec --locked bun -- bun scripts/dev/setup.ts --tools-only &&
    mise exec --locked bun -- bun install --frozen-lockfile --silent; } >"$log" 2>&1; then
    tail -n 20 "$log" >&2
    say "toolchain or dependency install failed in the run checkout; full log: $log"
    exit 5
  fi
  touch "$stamp"
fi
# Keep the three most recent run checkouts (names are commit SHAs) and the
# applied one: fleet/current points at it and T3's providers launch from there.
applied=$(basename "$(readlink "$(dirname "$runs")/current" 2>/dev/null || true)")
# shellcheck disable=SC2012
for old in $(ls -1td "$runs"/*/ | tail -n +4); do
  [ "$(basename "$old")" != "$applied" ] || continue
  git -C "$repo" worktree remove --force "$old" 2>/dev/null || true
  rm -f -- "${old%/}.setup.log" "${old%/}.ready"
done
git -C "$repo" worktree prune
export PERSONAL_WORKSPACE="$dir" PERSONAL_FLEET_RUN_CHECKOUT="$revision"
exec mise exec --locked bun -- bun packages/personal-cli/src/cli.ts fleet-sync --revision "$revision" "$@"
