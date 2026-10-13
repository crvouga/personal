#!/usr/bin/env bash
# Install one role from the live image. The USB ISO that CI built already
# contains ci, web, cache, and netboot. This machine picks the disk, generates
# the age key, and installs. No work computer, Nix build, or SSH key is required.
# FLEET_ALLOW_UNPRIVILEGED=1 is a unit-test seam. A real install is root.
set -euo pipefail

if [ "$(id -u)" -ne 0 ] && [ "${FLEET_ALLOW_UNPRIVILEGED:-}" != 1 ]; then
  exec sudo -n -- "$0" "$@"
fi

usage() {
  echo 'usage: fleet-install ci|web|cache|netboot' >&2
  echo 'ci-gpu is not on this image.' >&2
}

role=${1:-}
case "$role" in
  ci|web|cache|netboot) ;;
  ci-gpu)
    echo 'ci-gpu is not on the shared installer image. This image has ci, web, cache, and netboot.' >&2
    exit 2
    ;;
  *)
    usage
    exit 2
    ;;
esac

key_dir=${FLEET_KEY_DIR:-}
mounted_key=0
cleanup() {
  if [ "$mounted_key" -eq 1 ]; then
    umount "$key_dir" || true
  fi
}
trap cleanup EXIT

if [ -z "${FLEET_KEY_DIR:-}" ] && [ -e /dev/disk/by-label/FLEET-KEY ]; then
  key_dir=$(mktemp -d)
  mount /dev/disk/by-label/FLEET-KEY "$key_dir"
  mounted_key=1
fi

if [ -n "$key_dir" ] && [ -d "$key_dir" ]; then
  roles=(ci web cache netboot)
  for ((i = 0; i < ${#roles[@]}; i++)); do
    for ((j = i + 1; j < ${#roles[@]}; j++)); do
      left=$key_dir/${roles[$i]}.age
      right=$key_dir/${roles[$j]}.age
      if [ -f "$left" ] && [ -f "$right" ] && cmp -s "$left" "$right"; then
        echo "Role age keys must differ: ${roles[$i]} and ${roles[$j]}" >&2
        exit 2
      fi
    done
  done
fi

manifest=${FLEET_MANIFEST:-/iso/fleet-install-manifest}
if [ ! -f "$manifest" ]; then
  echo 'fleet-install: no role systems on this boot.' >&2
  echo 'Boot the USB image from the Fleet workflow artifact. A netboot ramdisk does not carry them.' >&2
  exit 1
fi

toplevel=$(awk -v role="$role" '$1 == role { print $2 }' "$manifest")
disko=$(awk '$1 == "disko" { print $2 }' "$manifest")
if [ -z "$toplevel" ] || [ ! -d "$toplevel" ]; then
  echo "fleet-install: $role is not a directory on this image" >&2
  exit 1
fi
if [ -z "$disko" ] || [ ! -x "$disko" ]; then
  echo 'fleet-install: disko script is missing on this image' >&2
  exit 1
fi

select_disk=${FLEET_SELECT_DISK:-select-disk}
age_keygen=${FLEET_AGE_KEYGEN:-age-keygen}
ssh_keygen=${FLEET_SSH_KEYGEN:-ssh-keygen}
nixos_install=${FLEET_NIXOS_INSTALL:-nixos-install}
mnt=${FLEET_MNT:-/mnt}
recorded=${FLEET_RECORDED:-/run/fleet-install-disk}

device=$("$select_disk")
[[ "$device" =~ ^/dev/[A-Za-z0-9._/:-]+$ ]] || {
  echo 'select-disk returned an unexpected path' >&2
  exit 2
}
install -d -m 0755 "$(dirname "$recorded")"
printf '%s\n' "$device" > "$recorded"
again=$("$select_disk")
[ "$again" = "$device" ] || {
  echo 'Disk selection changed. Nothing was wiped.' >&2
  exit 1
}

if [ ! -t 0 ]; then
  echo 'Refusing to wipe a disk without a terminal. Nothing was wiped.' >&2
  exit 2
fi
echo "Role: $role" >&2
echo "Disk: $device" >&2
echo 'This erases that disk, including Windows or any other OS.' >&2
echo 'Type the disk path to continue:' >&2
read -r answer
[ "$answer" = "$device" ] || {
  echo 'Disk path did not match. Nothing was changed.' >&2
  exit 1
}

"$disko"

secret=$mnt/nix/fleet-state/secrets
install -d -m 0700 "$secret"
dest=$secret/age.key
if [ -n "$key_dir" ] && [ -f "$key_dir/$role.age" ]; then
  install -m 0600 "$key_dir/$role.age" "$dest"
else
  "$age_keygen" -o "$dest"
  chmod 0600 "$dest"
  if [ -n "$key_dir" ]; then
    install -d -m 0700 "$key_dir"
    install -m 0600 "$dest" "$key_dir/$role.age"
  fi
fi
pub=$("$age_keygen" -y "$dest")
printf '%s\n' "$pub" > "$secret/age.pub"
chmod 0644 "$secret/age.pub"

ssh_dir=$mnt/nix/fleet-state/ssh
install -d -m 0700 "$ssh_dir"
if [ ! -s "$ssh_dir/ssh_host_ed25519_key" ]; then
  "$ssh_keygen" -t ed25519 -N "" -f "$ssh_dir/ssh_host_ed25519_key"
  chmod 0600 "$ssh_dir/ssh_host_ed25519_key"
fi

"$nixos_install" --no-root-passwd --root "$mnt" --system "$toplevel"

echo "installed role=$role" >&2
echo 'age public key:' >&2
printf '%s\n' "$pub" >&2
if [ -s "$ssh_dir/ssh_host_ed25519_key.pub" ]; then
  "$ssh_keygen" -lf "$ssh_dir/ssh_host_ed25519_key.pub" >&2
fi
echo 'Remove the USB and reboot. The console prints the public key again.' >&2
