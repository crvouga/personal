#!/bin/sh
# Read-only health of the fleet through dev-fleet at the pinned revision: every
# worker, the T3 provider instances declared for this machine and, on the
# manager, the CLI proxy. Changes nothing. Every check runs even when an earlier
# one fails; the exit code is 1 when any of them did.
set -u
here=$(cd "$(dirname "$0")" && pwd)
failed=''
check() {
  label=$1
  shift
  printf '\n== %s: devfleet %s ==\n' "$label" "$*" >&2
  sh "$here/fleet.sh" "$@" || failed="$failed $label"
}
check workers fleet-status --workers
check t3 t3-status
# The proxy runs only on the manager, which dev-fleet requires to be the macOS machine.
if [ "$(uname -s)" = Darwin ]; then check proxy cliproxy status; fi
if [ -n "$failed" ]; then
  printf '\nFailing:%s. Preview repairs with: bun run fleet:repair\n' "$failed" >&2
  exit 1
fi
printf '\nThe fleet is healthy.\n' >&2
