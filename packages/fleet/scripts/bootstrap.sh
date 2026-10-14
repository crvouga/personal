#!/usr/bin/env bash
# Optional remote keyboard for a machine that is already in the live image.
# The install, the disk choice, and the age key all happen on that machine.
# This computer does not build Nix and does not read an age key.
set -euo pipefail

role=${1:?role required: ci, web, cache, netboot, or devbox}
ip=${2:?IP address required}
[[ "$ip" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Use a DNS name or IPv4 address' >&2; exit 2; }

case "$role" in
  ci|web|cache|netboot|devbox) ;;
  ci-gpu)
    echo 'ci-gpu is not on the shared installer image.' >&2
    exit 2
    ;;
  *)
    echo 'role must be ci, web, cache, netboot, or devbox' >&2
    exit 2
    ;;
esac

if [ ! -t 0 ]; then
  echo "Refusing to install without a terminal. On the machine, run: fleet-install $role" >&2
  exit 2
fi

echo 'The machine runs fleet-install. This session only forwards the keyboard.' >&2
exec ssh -t -o StrictHostKeyChecking=accept-new -o BatchMode=yes "root@${ip}" "FLEET_AUTO=1 fleet-install ${role}"
