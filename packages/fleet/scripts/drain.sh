#!/usr/bin/env bash
set -euo pipefail
# Caller removes custom scheduler labels through GitHub's API before this script
# waits. Thus new jobs cannot be assigned while current jobs finish.
timeout="${1:-7200}"
[[ "$timeout" =~ ^[0-9]+$ ]] || { echo 'timeout must be seconds' >&2; exit 2; }
install -d -m 0755 /run/fleet
# Serialize with the job-start hook so no workflow reaches project code after drain begins.
exec 9>/run/fleet/gate
flock 9
touch /run/fleet/draining
flock -u 9
host="$(hostname)"
end=$((SECONDS + timeout))
matched=0
result=0
drain_one() {
  local remaining
  remaining=$((end - SECONDS))
  (( remaining > 0 )) || { echo 'Drain timed out; runner labels remain removed.' >&2; exit 1; }
  set +e
  runner-control drain "$1" "$2" "$FLEET_APP_ID" "$FLEET_INSTALLATION_ID" \
    /run/secrets/github-app-key "$host" "$remaining"
  result=$?
  set -e
}
read -r -a targets <<< "$FLEET_TARGETS"
for target in "${targets[@]}"; do
  drain_one "$FLEET_SCOPE" "$target"
  if (( result == 0 )); then matched=1
  elif (( result != 3 )); then exit "$result"
  fi
done
# Repositories the fleet API assigned to slots (recorded at registration in
# /run/fleet/assign-used). A runner there is drained like any other. One that
# GitHub cannot be asked about must not block updates; the job markers below
# are the check that does not depend on GitHub.
repo_pattern='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
for used in /run/fleet/assign-used/*; do
  [ -s "$used" ] || continue
  read -r repo < "$used" || continue
  [[ "$repo" =~ $repo_pattern ]] || continue
  if [ "$FLEET_SCOPE" = repository ] && [[ " $FLEET_TARGETS " == *" $repo "* ]]; then continue; fi
  drain_one repository "$repo"
  if (( result == 0 )); then matched=1
  elif (( result != 3 )); then echo "drain: repository $repo could not be checked (exit $result); using the local job markers" >&2
  fi
done
(( matched == 1 )) || { echo 'No fleet runners found in GitHub; refusing to stop services.' >&2; exit 1; }
# A running job is a file under /run/fleet/<slot>/busy. Wait for the last one.
while compgen -G '/run/fleet/*/busy' > /dev/null; do
  (( SECONDS < end )) || { echo 'Drain timed out; runner labels remain removed.' >&2; exit 1; }
  sleep 5
done
read -r -a runner_units <<< "$FLEET_UNITS"
systemctl stop "${runner_units[@]}"
echo "All runners drained and stopped. /run/fleet/draining remains until fleet-resume."
