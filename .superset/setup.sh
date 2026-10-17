#!/usr/bin/env bash
# Superset and super.engineering workspace setup for the development servers.
# Copy untracked package environments from the primary checkout, then install
# the monorepo dependencies. Idempotent — safe to re-run.
set -euo pipefail

ws="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
cd "$ws"

# Superset provides SUPERSET_ROOT_PATH. super.engineering runs hooks from the
# worktree, so fall back to Git's primary-worktree entry there.
root="${SUPERSET_ROOT_PATH:-}"
if [[ -z "$root" ]]; then
  root="$(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10); exit }')"
fi

if [[ -n "$root" && "$(cd "$root" && pwd -P)" != "$(pwd -P)" ]]; then
  for src in "$root"/packages/*/.env; do
    [[ -f "$src" ]] || continue
    rel="${src#"$root/"}"
    # These runtimes configure themselves. Never inherit another checkout's
    # provider selection, runtime token, database target, or development port.
    case "$rel" in
      packages/auth-relay/.env|packages/turborepo-remote-cache/.env) continue ;;
    esac
    if [[ ! -e "$rel" ]]; then
      mkdir -p "$(dirname "$rel")"
      cp -p "$src" "$rel"
      echo "copied $rel"
    fi
  done
fi

bun install --frozen-lockfile
