#!/usr/bin/env bash
# Boot the USB image and this installs the role from the boot menu.
# Windows, Linux, or an empty disk are the same: the internal disk is wiped.
# The netboot ramdisk has no manifest and leaves the disk alone.
# FLEET_SKIP_REBOOT=1 is the unit-test seam.
set -euo pipefail

if [ "$(id -u)" -ne 0 ] && [ "${FLEET_ALLOW_UNPRIVILEGED:-}" != 1 ]; then
  exec sudo -n --preserve-env=FLEET_AUTO,FLEET_ROLE,FLEET_CMDLINE,FLEET_KEY_DIR,FLEET_MANIFEST,FLEET_SKIP_REBOOT,FLEET_INSTALL -- "$0" "$@"
fi

manifest=${FLEET_MANIFEST:-/iso/fleet-install-manifest}
if [ ! -f "$manifest" ]; then
  echo 'No installer on this boot. The disk was not changed.' >&2
  exit 0
fi

if command -v udevadm >/dev/null 2>&1; then
  udevadm settle --timeout=30 || true
fi

export FLEET_AUTO=1
install=${FLEET_INSTALL:-fleet-install}
"$install"

echo 'Installed. If firmware boots this USB before the disk, pull the stick.' >&2
if [ "${FLEET_SKIP_REBOOT:-}" = 1 ]; then
  exit 0
fi
exec systemctl reboot
