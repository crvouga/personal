#!/usr/bin/env bash
# Linux only; macOS flashing is documented separately. Never run automatically.
set -euo pipefail
iso=${1:?ISO path required}
device=${2:?stable USB whole-disk path required}
[[ -f "$iso" && "$device" = /dev/disk/by-id/usb-* ]] || { echo 'Require ISO and /dev/disk/by-id/usb-*' >&2; exit 2; }
real=$(readlink -f "$device")
lsblk --paths --output NAME,TYPE,TRAN,SIZE,MODEL,SERIAL,MOUNTPOINTS "$real"
[[ $(lsblk -dn -o TYPE "$real") = disk && $(lsblk -dn -o TRAN "$real") = usb ]] || exit 2
if lsblk -nr -o MOUNTPOINTS "$real" | grep -q '[^[:space:]]'; then
  echo 'Device or descendants mounted; unmount explicitly and retry' >&2; exit 1
fi
echo "DESTRUCTIVE: writes $iso to $device ($real). Confirm human approval; type the full stable path:"
read -r answer
[[ "$answer" = "$device" ]] || exit 1
sudo dd if="$iso" of="$real" bs=4M conv=fsync status=progress
sync
