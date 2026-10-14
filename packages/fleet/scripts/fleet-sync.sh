#!/usr/bin/env bash
# Pull this role's nixosConfiguration from origin/main and switch to it.
# The system must already be in the binary cache. This script never builds.
# A kernel, initrd, or module change drains first, then waits, then reboots.
# A cache miss, a failed build lookup, or a failed drain leaves the running
# generation in place. The timer retries.
# After a switch, the node must still reach GitHub and the binary cache and
# the sync unit must still load. A failed check restores the previous
# generation and does not reboot.
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

previous=""
if [ -e "$profile" ]; then
  previous=$(readlink -f "$profile" || true)
fi

apply() {
  "$nix_env" -p "$profile" --set "$toplevel"
  "$toplevel/bin/switch-to-configuration" "$1"
}

# FLEET_HEALTH replaces the probes in tests. The default probes are the
# production check: GitHub, the configured cache's nix-cache-info, and a
# sync unit that still loads and is not already failed.
health_check() {
  if [ -n "${FLEET_HEALTH:-}" ]; then
    "$FLEET_HEALTH"
    return
  fi
  local curl_bin=${FLEET_CURL:-curl}
  # guard runs this in a conditional, where set -e does not apply.
  "$curl_bin" -fsS --max-time 20 -o /dev/null https://github.com || return 1
  "$curl_bin" -fsS --max-time 20 -o /dev/null "${CACHE_URL%/}/nix-cache-info" || return 1
  "$systemctl" cat fleet-sync.service >/dev/null || return 1
  local timer_state
  timer_state=$("$systemctl" is-failed fleet-sync.timer 2>/dev/null || true)
  if [ "$timer_state" = failed ]; then
    echo 'sync: fleet-sync.timer is failed' >&2
    return 1
  fi
}

report_path=${FLEET_REPORT:-/run/fleet/health-failure}

report_failure() {
  local mode=$1
  local reason=$2
  install -d -m 0755 "$(dirname "$report_path")" "$state_dir"
  {
    printf 'mode=%s\n' "$mode"
    printf 'previous=%s\n' "${previous:-none}"
    printf 'toplevel=%s\n' "$toplevel"
    printf '%s\n' "$reason"
  } > "$report_path"
  cp "$report_path" "$state_dir/health-failure"
  # TODO: central monitoring does not exist. The failed unit and this file
  # are the report. monitoring.pushUrl is not read. Do not invent a collector.
}

clear_failure() {
  rm -f "$report_path" "$state_dir/health-failure"
}

rollback() {
  local mode=$1
  local reason=$2
  echo 'sync: health check failed; rolling back to the previous generation' >&2
  printf '%s\n' "$reason" >&2
  report_failure "$mode" "$reason"
  if [ -n "$previous" ] && [ "$previous" != "$toplevel" ] && [ -x "$previous/bin/switch-to-configuration" ]; then
    "$nix_env" -p "$profile" --set "$previous"
    "$previous/bin/switch-to-configuration" "$mode"
  else
    echo 'sync: no previous generation to restore' >&2
  fi
  exit 1
}

# Run after apply. A failure restores the generation captured before --set
# and must not fall through to reboot.
guard() {
  local mode=$1
  local reason=""
  if ! reason=$(health_check 2>&1); then
    rollback "$mode" "$reason"
  fi
  clear_failure
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
  guard boot
  "$systemctl" reboot
else
  apply switch
  guard switch
fi
