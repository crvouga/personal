#!/usr/bin/env bash
# Legacy download of the 14-day Actions artifact. Needs gh and a git checkout.
# A new machine uses scripts/fleet-node.sh instead. That file is one download,
# it does not use this artifact, and it does not need Nix or a checkout.
# FLEET_GH overrides gh in tests.
set -euo pipefail

out=${1:-fleet-installer.iso}
gh=${FLEET_GH:-gh}
root=$(git rev-parse --show-toplevel)
cd "$root"

run=$("$gh" run list --workflow Fleet --status success --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -z "$run" ] || [ "$run" = null ]; then
  echo 'No successful Fleet run. The installer artifact is uploaded by that workflow.' >&2
  exit 1
fi

dir=$(mktemp -d)
cleanup() { rm -rf "$dir"; }
trap cleanup EXIT
"$gh" run download "$run" --name fleet-installer --dir "$dir"

iso=""
while IFS= read -r candidate; do
  iso=$candidate
  break
done < <(find "$dir" -type f -name 'fleet-installer.iso')
if [ -z "$iso" ]; then
  echo 'The Fleet artifact did not contain fleet-installer.iso' >&2
  exit 1
fi
cp "$iso" "$out"
echo "$out"
