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
read -r -a targets <<< "$FLEET_TARGETS"
for target in "${targets[@]}"; do
  remaining=$((end - SECONDS))
  (( remaining > 0 )) || { echo 'Drain timed out; runner labels remain removed.' >&2; exit 1; }
  set +e
  runner-control drain "$FLEET_SCOPE" "$target" "$FLEET_APP_ID" "$FLEET_INSTALLATION_ID" \
    /run/secrets/github-app-key "$host" "$remaining"
  result=$?
  set -e
  if (( result == 0 )); then matched=1
  elif (( result != 3 )); then exit "$result"
  fi
done
(( matched == 1 )) || { echo 'No fleet runners found in GitHub; refusing to stop services.' >&2; exit 1; }
read -r -a runner_units <<< "$FLEET_UNITS"
systemctl stop "${runner_units[@]}"
echo "All runners drained and stopped. /run/fleet/draining remains until fleet-resume."
