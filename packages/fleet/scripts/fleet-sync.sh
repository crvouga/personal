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

# Dynamic settings from the fleet API (scripts/fleetconf.py). The fleet works
# without them: a missing or unreadable setting gives the value built into this
# image, and a failing reader never stops a sync.
conf() {
  local value
  if [ -n "${FLEETCONF:-}" ] && value=$("$FLEETCONF" get "$1" "$2" 2>/dev/null); then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$2"
  fi
}

if [ "$(conf sync.paused false)" = true ]; then
  echo 'sync: paused by the fleet configuration (sync.paused); the running system is unchanged' >&2
  exit 0
fi

reboot_disabled=0
if [ "$(conf reboot.enabled true)" = false ]; then
  reboot_disabled=1
fi
delay_max=$(conf reboot.delayMaxSeconds "$DELAY_MAX")
case "$delay_max" in
  ""|*[!0-9]*) delay_max=$DELAY_MAX ;;
esac
DELAY_MAX=$delay_max

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
# Share one open-file-description lock with our children. A power loss releases
# it automatically; another invocation cannot race a live Git/activation step.
exec 9>"$state_dir/update.lock"
if "${PYTHON:?}" - <<'PY'
import fcntl,sys
try:
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(75)
PY
then
  :
else
  status=$?
  if [ "$status" -eq 75 ]; then
    echo 'sync: another update is running; the timer will retry'
    exit 0
  fi
  exit "$status"
fi
# This checkout is only an update cache. With no live writer, Git lock files
# left by an interrupted fetch/checkout are stale and safe to discard.
"${PYTHON:?}" - "$repo/.git" <<'PY'
from pathlib import Path
import sys
for path in Path(sys.argv[1]).rglob('*.lock'):
    if path.is_file():
        path.unlink()
PY
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
drained=0
reboot_requested=0
failure_reason='could not fetch the configured repository'
reported_failure=0
report_path=${FLEET_REPORT:-/run/fleet/health-failure}
cleanup() {
  local status=$?
  if [ -n "$askpass" ]; then
    rm -f "$askpass" || true
  fi
  if [ "$drained" -eq 1 ] && [ "$reboot_requested" -eq 0 ]; then
    rm -f "$(dirname "$report_path")/update-draining"
    echo 'sync: update did not reboot; restoring runner admission and services' >&2
    if [ -z "${RESUME_COMMAND:-}" ] || ! bounded "${FLEET_ACTIVATION_TIMEOUT:-300}" "$RESUME_COMMAND"; then
      install -d -m 0755 "$(dirname "$report_path")"
      printf 'recover failed sync\n' > "$(dirname "$report_path")/agent-drained"
      echo 'FLEET-FAIL sync: runner recovery failed; fleet-resume must succeed before this node can accept jobs' >&2
      status=1
    fi
  fi
  if [ "$status" -ne 0 ] && [ "$reported_failure" -eq 0 ]; then
    install -d -m 0755 "$(dirname "$report_path")"
    printf 'mode=sync\n%s (exit %s)\n' "$failure_reason" "$status" > "$report_path"
    cp "$report_path" "$state_dir/health-failure"
    echo "FLEET-FAIL sync: $failure_reason (exit $status); the running generation was kept" >&2
  fi
  if [ "$status" -eq 0 ]; then
    printf '%s\n' "${revision:-unknown}" > "$state_dir/last-success"
    rm -f "$state_dir/pending-generation"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
bounded() {
  local duration=$1
  shift
  timeout --kill-after="${FLEET_TIMEOUT_KILL_AFTER:-30}" "$duration" "$@"
}
bounded "${FLEET_FETCH_TIMEOUT:-120}" "$git" -c "safe.directory=$repo" -C "$repo" fetch --depth=1 origin "refs/heads/${branch}:refs/remotes/origin/${branch}"
g -C "$repo" checkout --detach --force "refs/remotes/origin/${branch}"

# An unconfigured cache must wait. Building locally would publish a system
# the rest of the fleet cannot substitute.
if [ -z "${CACHE_URL:-}" ] || [[ "$CACHE_URL" == *TODO* ]]; then
  failure_reason='binary cache is not configured; automatic updates are blocked until its URL and signing key are configured'
  echo 'sync: binary cache is not configured; waiting' >&2
  exit 1
fi

revision=$(g -C "$repo" rev-parse HEAD)
# A path flake loses self.rev and cannot match the system published by CI.
# Pin the Git source and revision exactly, including the monorepo directory.
flake="git+file://${repo}?shallow=1&rev=${revision}&dir=${FLAKE_DIR}#nixosConfigurations.${FLAKE_ATTR}.config.system.build.toplevel"
failure_reason='the requested revision could not be substituted; verify cache publication, signing key and network connectivity'
if ! toplevel=$(bounded "${FLEET_SUBSTITUTE_TIMEOUT:-600}" "$nix" build --no-write-lock-file --max-jobs 0 --option connect-timeout 15 --option stalled-download-timeout 60 --option narinfo-cache-negative-ttl 0 --no-link --print-out-paths "$flake"); then
  echo 'sync: system is not in the binary cache; not building locally' >&2
  exit 1
fi
[ -n "$toplevel" ] && [ -d "$toplevel" ]
toplevel=$(readlink -f "$toplevel")

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
roots=${FLEET_GC_ROOTS:-/nix/var/nix/gcroots}
rollback_root=$roots/fleet-update-previous
# The profile can already name an unverified candidate after a power loss.
# Keep the saved previous generation rather than overwriting its recovery root.
if [ -e "$rollback_root" ] && { \
  { [ "$previous" = "$toplevel" ] \
    && [ "$(cat "$state_dir/last-success" 2>/dev/null || true)" != "$revision" ]; } \
  || [ "$previous" = "$(cat "$state_dir/pending-generation" 2>/dev/null || true)" ]; }; then
  saved_previous=$(readlink -f "$rollback_root" || true)
  if [ -n "$saved_previous" ] && [ "$saved_previous" != "$toplevel" ] \
    && [ -x "$saved_previous/bin/switch-to-configuration" ]; then
    previous=$saved_previous
  fi
fi
if [ -n "$previous" ] && { [[ "$previous" == /nix/store/* ]] || [ -n "${FLEET_GC_ROOTS:-}" ]; }; then
  install -d -m 0755 "$roots"
  ln -sfn "$previous" "$rollback_root"
fi

apply() {
  # Persist before profile selection, so a later main commit cannot turn an
  # interrupted, unverified candidate into the next update's rollback target.
  printf '%s\n' "$toplevel" > "$state_dir/pending-generation.next"
  mv -f "$state_dir/pending-generation.next" "$state_dir/pending-generation"
  if ! bounded "${FLEET_ACTIVATION_TIMEOUT:-300}" "$nix_env" -p "$profile" --set "$toplevel"; then
    rollback "$1" 'FLEET_PROFILE_FAILED: could not select the requested generation'
  fi
  if ! bounded "${FLEET_ACTIVATION_TIMEOUT:-300}" "$toplevel/bin/switch-to-configuration" "$1"; then
    rollback "$1" 'FLEET_ACTIVATION_FAILED: generation activation failed before health verification'
  fi
}

# Timer/service checks always run. FLEET_HEALTH replaces only the external
# connectivity/signature probes in isolated tests.
health_check() {
  "$systemctl" cat fleet-sync.service >/dev/null || return 1
  if ! "$systemctl" is-active --quiet fleet-sync.timer; then
    echo 'sync: fleet-sync.timer is not active' >&2
    return 1
  fi
  if ! "$systemctl" is-enabled --quiet fleet-sync.timer; then
    echo 'sync: fleet-sync.timer is not enabled for the next boot' >&2
    return 1
  fi
  if [ -n "${FLEET_HEALTH:-}" ]; then
    "$FLEET_HEALTH"
    return
  fi
  local curl_bin=${FLEET_CURL:-curl}
  local target_cache=$CACHE_URL
  local target_key=""
  # Verify the new generation's recovery configuration, not the old process's
  # environment: a bad new cache URL/key must roll back while repair is possible.
  if [ -f "$toplevel/etc/fleet/bootstrap.json" ]; then
    local cache_config
    cache_config=$("${PYTHON:?}" - "$toplevel/etc/fleet/bootstrap.json" <<'PY'
import json,sys
from urllib.parse import urlparse
document=json.load(open(sys.argv[1]))
url,key=document['cacheUrl'],document['cachePublicKey']
parsed=urlparse(url)
if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not isinstance(key,str) or '\n' in key:
    sys.exit(1)
print(url); print(key)
PY
    ) || return 1
    target_cache=${cache_config%%$'\n'*}
    target_key=${cache_config#*$'\n'}
    bounded 45 "$nix" store verify --store "$target_cache" --no-contents --sigs-needed 1 \
      --option trusted-public-keys "$target_key" --option narinfo-cache-negative-ttl 0 "$toplevel" || return 1
  fi
  # guard runs this in a conditional, where set -e does not apply.
  "$curl_bin" -fsS --max-time 20 -o /dev/null https://github.com || return 1
  "$curl_bin" -fsS --max-time 20 -o /dev/null "${target_cache%/}/nix-cache-info" || return 1
}

pending_path=${FLEET_REBOOT_PENDING:-/run/fleet/reboot-pending}

report_failure() {
  reported_failure=1
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
  # The node agent reports this safe persisted failure through the Fleet API.
}

clear_failure() {
  rm -f "$report_path" "$state_dir/health-failure"
}

rollback() {
  local mode=$1
  local reason=$2
  echo 'sync: update failed; rolling back to the previous generation' >&2
  printf '%s\n' "$reason" >&2
  report_failure rollback-pending "$reason"
  if [ -n "$previous" ] && [ "$previous" != "$toplevel" ] && [ -x "$previous/bin/switch-to-configuration" ]; then
    if bounded "${FLEET_ACTIVATION_TIMEOUT:-300}" "$nix_env" -p "$profile" --set "$previous" \
      && bounded "${FLEET_ACTIVATION_TIMEOUT:-300}" "$previous/bin/switch-to-configuration" "$mode"; then
      report_failure "$mode" "$reason"
    else
      report_failure rollback-failed "FLEET_ROLLBACK_FAILED: $reason; restoring the previous generation also failed. Automatic sync will retry."
    fi
  else
    echo 'sync: no previous generation to restore' >&2
    report_failure rollback-failed "FLEET_ROLLBACK_UNAVAILABLE: $reason; no previous generation can be restored. Automatic sync will retry."
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

if [ "$need_reboot" -eq 0 ] && [ "$previous" = "$toplevel" ] \
  && [ "$(cat "$state_dir/last-success" 2>/dev/null || true)" = "$revision" ] \
  && [ ! -e "$state_dir/health-failure" ]; then
  failure_reason='the running revision could not verify GitHub/cache connectivity or the update timer'
  health_check || exit 1
  clear_failure
  echo "sync: already running revision $revision"
  exit 0
fi

if [ "$need_reboot" -eq 1 ] && [ "$reboot_disabled" -eq 1 ]; then
  # reboot.enabled is false. The new system is switched to and nothing is
  # drained or rebooted. The kernel change waits, and the agent reports it.
  apply switch
  guard switch
  install -d -m 0755 "$(dirname "$pending_path")"
  printf 'toplevel=%s\n' "$toplevel" > "$pending_path"
  echo 'sync: switched; a reboot is pending because reboot.enabled is false' >&2
elif [ "$need_reboot" -eq 1 ]; then
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
  # Keep serving work during the rollout jitter. Drain only immediately before
  # applying the boot generation, rather than leaving a node idle for hours.
  failure_reason='update was interrupted before the reboot was committed'
  if [ "$DELAY_MAX" -gt 0 ]; then
    sleep "$delay"
  fi
  if [ -n "${DRAIN_COMMAND:-}" ]; then
    [ -n "${RESUME_COMMAND:-}" ] || { echo 'sync: drain requires an automatic resume command; refusing to drain' >&2; exit 1; }
    drained=1
    install -d -m 0755 "$(dirname "$report_path")"
    touch "$(dirname "$report_path")/update-draining"
    printf 'recover interrupted update\n' > "$(dirname "$report_path")/agent-drained"
    export PATH="/run/current-system/sw/bin:${PATH:-}"
    bounded "$((${DRAIN_TIMEOUT:-7200} + 30))" "$DRAIN_COMMAND" "${DRAIN_TIMEOUT:-7200}"
  fi
  apply boot
  guard boot
  reboot_requested=1
  if ! "$systemctl" reboot; then
    reboot_requested=0
    rollback boot 'reboot request failed; restoring the previous boot generation'
  fi
else
  apply switch
  guard switch
  rm -f "$pending_path"
fi
