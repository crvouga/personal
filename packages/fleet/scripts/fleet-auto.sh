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
systemctl=${FLEET_SYSTEMCTL:-systemctl}
started_file=${FLEET_AUTO_STATE:-/run/fleet-auto-started}
if [ "${FLEET_SKIP_REBOOT:-}" != 1 ]; then
  if [ ! -f "$started_file" ]; then
    python3 -c 'import time; print(int(time.monotonic()))' > "$started_file"
  fi
fi
if "$install"; then
  :
else
  status=$?
  if [ "$status" -eq 75 ] && [ -e "${FLEET_INSTALL_LOG:-/run/fleet-install.log}.erasing" ]; then
    echo 'FLEET_INSTALL_STOPPED: disk operations began; automatic pre-wipe retries are disabled. Review the reported installation failure.' >&2
    status=2
  fi
  if [ "$status" -eq 75 ] && [ "${FLEET_SKIP_REBOOT:-}" != 1 ]; then
    read -r started < "$started_file"
    now=$(python3 -c 'import time; print(int(time.monotonic()))')
    wait_limit=${FLEET_NETWORK_WAIT_SECONDS:-300}
    if [[ "$started" =~ ^[0-9]+$ && "$wait_limit" =~ ^[0-9]+$ ]] && [ "$((now - 10#$started))" -ge "$wait_limit" ]; then
      echo 'FLEET_NETWORK_WAIT_EXPIRED: bounded network retries did not establish connectivity. Nothing was erased.' >&2
      status=2
    fi
  fi
  if [ "$status" -ne 75 ] && command -v qrencode >/dev/null 2>&1; then
    {
      printf 'Fleet installer diagnostic\nExit: %s\nDisk operations started: %s\n' \
        "$status" "$([ -e "${FLEET_INSTALL_LOG:-/run/fleet-install.log}.erasing" ] && echo yes || echo no)"
      if [ -f "${FLEET_INSTALL_LOG:-/run/fleet-install.log}.diagnostic" ]; then
        head -c 1024 "${FLEET_INSTALL_LOG:-/run/fleet-install.log}.diagnostic"
      fi
      printf '\nCopy this node diagnostic from fleet.chrisvouga.dev. If it never registered, reopen the wizard on the original system.\n'
    } | qrencode -t ANSIUTF8 >&2 || true
  fi
  # A staged conversion keeps the original OS until all integration checks
  # pass. On a permanent pre-wipe failure, boot it again instead of stranding
  # the person in the live image. Never retry or reboot after disk work starts.
  if [ "$status" -ne 75 ] && [ "${FLEET_SKIP_REBOOT:-}" != 1 ] \
    && [ ! -e "${FLEET_INSTALL_LOG:-/run/fleet-install.log}.erasing" ] \
    && grep -Eq '(^|[[:space:]])fleet\.enroll=' "${FLEET_CMDLINE:-/proc/cmdline}"; then
    echo 'FLEET-FAIL: installation stopped before disk changes. The error is reported in Fleet when enrollment succeeded. Returning to the original system in 60 seconds; reopen the wizard after the platform issue is repaired.' >&2
    sleep 60
    exec "$systemctl" reboot
  fi
  exit "$status"
fi

echo 'Installed. If firmware boots this USB before the disk, pull the stick.' >&2
if [ "${FLEET_SKIP_REBOOT:-}" = 1 ]; then
  exit 0
fi
exec "$systemctl" reboot
