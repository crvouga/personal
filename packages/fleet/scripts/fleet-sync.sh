#!/usr/bin/env bash
# Pull this role's nixosConfiguration from origin/main and switch to it.
# The system must already be in the binary cache. This script never builds.
# A kernel, initrd, or module change drains first, then waits, then reboots.
# A cache miss, a failed build lookup, or a failed drain leaves the running
# generation in place. The timer retries.
set -euo pipefail

env_file=${SYNC_ENV:-/etc/fleet/sync.env}
# shellcheck disable=SC1090
source "$env_file"

: "${ROLE:?}"
: "${FLAKE_ATTR:?}"
: "${BRANCH:?}"
: "${REPO_URL:?}"
: "${FLAKE_DIR:?}"
: "${DELAY_MAX:?}"

if [[ "$REPO_URL" == *TODO* ]]; then
  echo 'sync: repository URL is not configured; the running system is unchanged' >&2
  exit 0
fi

if [ "$BRANCH" != "main" ]; then
  echo 'sync: BRANCH must be main' >&2
  exit 1
fi

nix=${FLEET_NIX:-nix}
nix_env=${FLEET_NIX_ENV:-nix-env}
systemctl=${FLEET_SYSTEMCTL:-systemctl}
git=${FLEET_GIT:-git}
profile=${FLEET_PROFILE:-/nix/var/nix/profiles/system}
booted=${BOOTED_SYSTEM:-/run/booted-system}
state_dir=${STATE_DIR:-/nix/fleet-state/sync}
repo=$state_dir/repo
branch=$BRANCH

install -d -m 0700 "$state_dir"
g() {
  if [[ "$REPO_URL" == file:* ]]; then
    "$git" -c "safe.directory=$repo" -c protocol.file.allow=always "$@"
  else
    "$git" -c "safe.directory=$repo" "$@"
  fi
}

if [ ! -d "$repo/.git" ]; then
  g init -q "$repo"
fi

askpass=""
cleanup() {
  if [ -n "$askpass" ]; then
    rm -f "$askpass"
  fi
}
trap cleanup EXIT

if [ -n "${GIT_KEY:-}" ] && [ -f "$GIT_KEY" ]; then
  known=${GIT_KNOWN_HOSTS:-/etc/fleet/git-known-hosts}
  quoted_key=$(printf '%q' "$GIT_KEY")
  quoted_known=$(printf '%q' "$known")
  GIT_SSH_COMMAND="ssh -i ${quoted_key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quoted_known}"
  export GIT_SSH_COMMAND
elif [ -n "${GIT_TOKEN:-}" ] && [ -f "$GIT_TOKEN" ]; then
  askpass=$(mktemp)
  chmod 700 "$askpass"
  cat > "$askpass" <<EOF
#!/bin/sh
case "\$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) cat $(printf '%q' "$GIT_TOKEN") ;;
esac
EOF
  chmod 700 "$askpass"
  export GIT_ASKPASS=$askpass
  export GIT_TERMINAL_PROMPT=0
fi

g -C "$repo" remote remove origin 2>/dev/null || true
g -C "$repo" remote add origin "$REPO_URL"
g -C "$repo" fetch --depth=1 origin "refs/heads/${branch}:refs/remotes/origin/${branch}"
g -C "$repo" checkout --detach --force "refs/remotes/origin/${branch}"

# An unconfigured cache must wait. Building locally would publish a system
# the rest of the fleet cannot substitute.
if [ -z "${CACHE_URL:-}" ] || [[ "$CACHE_URL" == *TODO* ]]; then
  echo 'sync: binary cache is not configured; waiting' >&2
  exit 1
fi

flake="path:${repo}/${FLAKE_DIR}#nixosConfigurations.${FLAKE_ATTR}.config.system.build.toplevel"
if ! toplevel=$("$nix" build --max-jobs 0 --no-link --print-out-paths "$flake"); then
  echo 'sync: system is not in the binary cache; not building locally' >&2
  exit 1
fi
[ -n "$toplevel" ] && [ -d "$toplevel" ]

need_reboot=0
if [ -e "$booted/kernel" ] && [ -e "$toplevel/kernel" ]; then
  if [ "$(readlink -f "$booted/kernel")" != "$(readlink -f "$toplevel/kernel")" ] \
    || [ "$(readlink -f "$booted/initrd")" != "$(readlink -f "$toplevel/initrd")" ] \
    || [ "$(readlink -f "$booted/kernel-modules")" != "$(readlink -f "$toplevel/kernel-modules")" ]; then
    need_reboot=1
  fi
fi

apply() {
  "$nix_env" -p "$profile" --set "$toplevel"
  "$toplevel/bin/switch-to-configuration" "$1"
}

if [ "$need_reboot" -eq 1 ]; then
  delay=0
  if [ "$DELAY_MAX" -gt 0 ]; then
    # Resolve the id before draining. A missing id must not stop runners
    # and then fail to reboot.
    id=$("${PYTHON:?}" "${CATTLE_PY:?}" print-id) || {
      echo 'sync: stable id failed; not rebooting' >&2
      exit 1
    }
    seed=$(printf '%s' "$id" | cksum | awk '{print $1}')
    delay=$((seed % DELAY_MAX))
  fi
  if [ -n "${DRAIN_COMMAND:-}" ]; then
    export PATH="/run/current-system/sw/bin:${PATH:-}"
    "$DRAIN_COMMAND" "${DRAIN_TIMEOUT:-7200}"
  fi
  if [ "$DELAY_MAX" -gt 0 ]; then
    sleep "$delay"
  fi
  apply boot
  "$systemctl" reboot
else
  apply switch
fi
