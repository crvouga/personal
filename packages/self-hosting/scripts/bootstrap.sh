#!/usr/bin/env bash
# Install one role onto a machine that is already booted into the shared
# installer (USB or PXE). This is the only SSH write. After it returns, the
# node pulls from git.
set -euo pipefail

role=${1:?role required: ci, web, cache, or netboot}
ip=${2:?IP address required}
[[ "$ip" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Use a DNS name or IPv4 address' >&2; exit 2; }

case "$role" in
  ci) settings_file=fleet.nix ;;
  web) settings_file=web.nix ;;
  cache) settings_file=cache.nix ;;
  netboot) settings_file=netboot.nix ;;
  *) echo 'role must be ci, web, cache, or netboot' >&2; exit 2 ;;
esac

dir=$PWD
while [ "$dir" != / ]; do
  if [ -f "$dir/flake.nix" ] && [ -f "$dir/fleet.nix" ]; then
    cd "$dir"
    break
  fi
  dir=$(dirname "$dir")
done
[ -f flake.nix ] || { echo 'Run this from packages/self-hosting' >&2; exit 2; }

if [ -n "${SELF_HOSTING_KEY_DIR:-}" ]; then
  key_dir=$SELF_HOSTING_KEY_DIR
else
  key_dir=${HOME:?}/.config/self-hosting/keys
fi
key=$key_dir/$role.age
[ -f "$key" ] || {
  echo "TODO: create $key with age-keygen. It stays on this computer and is never committed." >&2
  exit 2
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$repo_root" ]; then
  key_real=$(realpath "$key")
  case "$key_real" in
    "$repo_root"/*)
      echo 'Refusing to read an age key from the git checkout' >&2
      exit 2
      ;;
  esac
fi

# Every pair of role keys that both exist must differ. CI and web never share one.
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

disk=$(nix eval --raw --file "$settings_file" disk)
[[ "$disk" == /dev/disk/by-path/* || "$disk" == /dev/disk/by-id/* ]] || {
  echo 'Disk path must be a /dev/disk/by-path or by-id path' >&2
  exit 2
}
[[ "$disk" != *TODO* ]] || {
  echo "TODO: set a verified disk path in $settings_file before bootstrap" >&2
  exit 2
}

keys=$(nix eval --json --file "$settings_file" sshKeys)
[ "$keys" != "[]" ] || {
  echo 'TODO: set admin public SSH keys in settings/shared.nix before bootstrap' >&2
  exit 2
}

echo "Role: $role" >&2
echo "Host: $ip" >&2
echo "Disk: $disk" >&2
echo "Key file: $key" >&2
echo 'This erases that disk, including Windows or any other OS.' >&2
if [ ! -t 0 ]; then
  echo 'Refusing to wipe a disk without a terminal confirmation.' >&2
  exit 2
fi
echo 'Type the disk path to continue:' >&2
read -r answer
[ "$answer" = "$disk" ] || { echo 'Disk path did not match. Nothing was changed.' >&2; exit 1; }

stage=$(mktemp -d)
chmod 700 "$stage"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
install -d -m 0700 "$stage/nix/fleet-state/secrets"
install -m 0600 "$key" "$stage/nix/fleet-state/secrets/age.key"

disko_script=$(nix build --no-link --print-out-paths "path:.#disko-${role}")
toplevel=$(nix build --no-link --print-out-paths "path:.#${role}")
nixos-anywhere --store-paths "$disko_script" "$toplevel" --extra-files "$stage" "root@${ip}"
