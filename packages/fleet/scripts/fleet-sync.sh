#!/usr/bin/env bash
# Pull this closure's nixosConfiguration from git and switch to it.
# TRACK=canary follows the canary branch. TRACK=deploy follows deploy.
# A kernel, initrd, or module change drains (when configured) and reboots
# after a delay seeded by the stable node id. A failed build or a failed
# drain leaves the running generation in place.
set -euo pipefail

env_file=${SYNC_ENV:-/etc/fleet/sync.env}
# shellcheck disable=SC1090
source "$env_file"

: "${ROLE:?}"
: "${FLAKE_ATTR:?}"
: "${TRACK:?}"
: "${REPO_URL:?}"
: "${DEPLOY_BRANCH:?}"
: "${CANARY_BRANCH:?}"
: "${FLAKE_DIR:?}"
: "${DELAY_MAX:?}"

if [[ "$REPO_URL" == *TODO* ]]; then
  echo 'sync: repository URL is not configured; the running system is unchanged' >&2
  exit 0
fi

nix=${FLEET_NIX:-nix}
nix_env=${FLEET_NIX_ENV:-nix-env}
systemctl=${FLEET_SYSTEMCTL:-systemctl}
git=${FLEET_GIT:-git}
state_dir=${STATE_DIR:-/nix/fleet-state/sync}
repo=$state_dir/repo

case "$TRACK" in
  canary) branch=$CANARY_BRANCH ;;
  deploy) branch=$DEPLOY_BRANCH ;;
  *) echo 'sync: TRACK must be deploy or canary' >&2; exit 1 ;;
esac

install -d -m 0700 "$state_dir"
g() {
  "$git" -c "safe.directory=$repo" "$@"
}

if [ ! -d "$repo/.git" ]; then
  g init -q "$repo"
fi
if [[ "$REPO_URL" == file:* ]]; then
  g config --global protocol.file.allow always
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

flake="path:${repo}/${FLAKE_DIR}#nixosConfigurations.${FLAKE_ATTR}.config.system.build.toplevel"
toplevel=$("$nix" build --no-link --print-out-paths "$flake")
[ -n "$toplevel" ] && [ -d "$toplevel" ]

need_reboot=0
booted=/run/booted-system
if [ -e "$booted/kernel" ] && [ -e "$toplevel/kernel" ]; then
  if [ "$(readlink -f "$booted/kernel")" != "$(readlink -f "$toplevel/kernel")" ] \
    || [ "$(readlink -f "$booted/initrd")" != "$(readlink -f "$toplevel/initrd")" ] \
    || [ "$(readlink -f "$booted/kernel-modules")" != "$(readlink -f "$toplevel/kernel-modules")" ]; then
    need_reboot=1
  fi
fi

apply() {
  "$nix_env" -p /nix/var/nix/profiles/system --set "$toplevel"
  "$toplevel/bin/switch-to-configuration" "$1"
}

if [ "$need_reboot" -eq 1 ]; then
  if [ "$DELAY_MAX" -gt 0 ]; then
    id=$("${PYTHON:?}" "${CATTLE_PY:?}" print-id) || {
      echo 'sync: stable id failed; not rebooting' >&2
      exit 1
    }
    seed=$(printf '%s' "$id" | cksum | awk '{print $1}')
    sleep $((seed % DELAY_MAX))
  fi
  if [ -n "${DRAIN_COMMAND:-}" ]; then
    export PATH="/run/current-system/sw/bin:${PATH:-}"
    "$DRAIN_COMMAND" "${DRAIN_TIMEOUT:-7200}"
  fi
  apply boot
  "$systemctl" reboot
else
  apply switch
fi
