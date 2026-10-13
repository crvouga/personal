#!/usr/bin/env bash
# Install one role onto a machine that is already booted into the shared
# installer (USB or PXE). This is the only SSH write. After it returns, the
# node pulls from git. The disk is chosen on the target. Nothing in git names it.
set -euo pipefail

role=${1:?role required: ci, web, cache, netboot, ci-gpu, or a -canary track}
ip=${2:?IP address required}
[[ "$ip" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Use a DNS name or IPv4 address' >&2; exit 2; }

case "$role" in
  ci|web|cache|netboot|ci-gpu|ci-canary|web-canary|cache-canary|netboot-canary) ;;
  *) echo 'role must be ci, web, cache, netboot, ci-gpu, or a -canary track' >&2; exit 2 ;;
esac
key_role=${role%%-*}

dir=$PWD
while [ "$dir" != / ]; do
  if [ -f "$dir/flake.nix" ] && [ -f "$dir/fleet.nix" ]; then
    cd "$dir"
    break
  fi
  dir=$(dirname "$dir")
done
[ -f flake.nix ] || { echo 'Run this from packages/fleet' >&2; exit 2; }

if [ -n "${FLEET_KEY_DIR:-}" ]; then
  key_dir=$FLEET_KEY_DIR
else
  key_dir=${HOME:?}/.config/fleet/keys
fi
key=$key_dir/$key_role.age
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

keys=$(nix eval --json --file settings/shared.nix sshKeys)
[ "$keys" != "[]" ] || {
  echo 'TODO: set admin public SSH keys in settings/shared.nix before bootstrap' >&2
  exit 2
}

ssh_base=(ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
discovered=$("${ssh_base[@]}" "root@${ip}" select-disk)
[[ "$discovered" =~ ^/dev/[A-Za-z0-9._/:-]+$ ]] || {
  echo 'select-disk returned an unexpected path' >&2
  exit 2
}

echo "Role: $role" >&2
echo "Host: $ip" >&2
echo "Disk: $discovered" >&2
echo "Key file: $key" >&2
echo 'This erases that disk, including Windows or any other OS.' >&2
if [ ! -t 0 ]; then
  echo 'Refusing to wipe a disk without a terminal confirmation.' >&2
  exit 2
fi
echo 'Type the disk path to continue:' >&2
read -r answer
[ "$answer" = "$discovered" ] || { echo 'Disk path did not match. Nothing was changed.' >&2; exit 1; }

printf '%s\n' "$discovered" | "${ssh_base[@]}" "root@${ip}" "cat > /run/fleet-install-disk"
again=$("${ssh_base[@]}" "root@${ip}" select-disk)
[ "$again" = "$discovered" ] || {
  echo 'Disk selection changed before install. Nothing was wiped.' >&2
  exit 1
}

stage=$(mktemp -d)
chmod 700 "$stage"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
install -d -m 0700 "$stage/nix/fleet-state/secrets"
install -m 0600 "$key" "$stage/nix/fleet-state/secrets/age.key"

disko_script=$(nix build --no-link --print-out-paths "path:.#disko")
toplevel=$(nix build --no-link --print-out-paths "path:.#nixosConfigurations.${role}.config.system.build.toplevel")
nixos-anywhere --store-paths "$disko_script" "$toplevel" --extra-files "$stage" "root@${ip}"
