#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
operation=${1:?operation required}
node=${2:?SSH host required}
# Restrict host arguments to avoid SSH option injection and remote shell expansion.
[[ "$node" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Use a DNS name or IPv4 address' >&2; exit 2; }
case "$operation" in
  status)
    ssh "root@$node" 'systemctl --no-pager status "github-runner-*"; df -h / /nix /boot; du -sh /nix/ci-cache; systemctl --no-pager list-timers; readlink /run/current-system'
    ;;
  drain)
    ssh "root@$node" 'fleet-drain'
    ;;
  resume)
    ssh "root@$node" 'fleet-resume'
    ;;
  verify)
    expected=$(nix build --no-link --print-out-paths path:.#node)
    actual=$(ssh "root@$node" 'readlink /run/current-system')
    [[ "$expected" = "$actual" ]] || { echo "Mismatch: expected $expected; actual $actual" >&2; exit 1; }
    echo "Verified: $actual"
    ;;
  deploy)
    next=$(nix build --no-link --print-out-paths path:.#node)
    nix copy --to "ssh-ng://root@$node" "$next"
    # No reboot until drain succeeds. Keep previous generation for manual rollback.
    # Store paths are controlled Nix output paths and need expansion in the remote command.
    # shellcheck disable=SC2029
    # shellcheck disable=SC2029 # $next is a locally built Nix store path, intentionally sent remotely.
    ssh "root@$node" "fleet-drain && nix-env -p /nix/var/nix/profiles/system --set '$next' && '$next/bin/switch-to-configuration' boot && systemctl reboot"
    ;;
  provision)
    key=${3:?local fleet age key path required}
    [[ -f "$key" ]] || exit 2
    # Never put key contents into arguments, environment, stdout, or the Nix store.
    ssh "root@$node" 'install -d -m 0700 /nix/fleet-state/secrets; umask 077; cat > /nix/fleet-state/secrets/age.key.new; mv /nix/fleet-state/secrets/age.key.new /nix/fleet-state/secrets/age.key' < "$key"
    ssh "root@$node" 'systemctl restart sops-install-secrets.service && fleet-resume'
    ;;
  reinstall)
    echo "DESTRUCTIVE: erases internal NVMe on $node, including local key, caches and SSH identity."
    disk=$(sed -n 's/^[[:space:]]*disk = "\([^"]*\)";.*/\1/p' fleet.nix | head -n 1)
    [[ -n "$disk" && "$disk" != *TODO* ]] || { echo 'Set the verified stable disk path in fleet.nix first.' >&2; exit 2; }
    echo "Target node: $node"
    echo "Target disk: $disk"
    echo "Obtain explicit human approval first. Type the exact disk path to continue:"
    read -r answer
    [[ "$answer" = "$disk" ]] || exit 1
    extra=${3:?secure extra-files directory with nix/fleet-state/secrets/age.key required}
    [[ -f "$extra/nix/fleet-state/secrets/age.key" ]] || exit 2
    ssh "root@$node" 'fleet-drain'
    disko=$(nix build --no-link --print-out-paths path:.#disko)
    next=$(nix build --no-link --print-out-paths path:.#node)
    # The guarded disko script runs in the kexec rescue system, before formatting.
    nix run path:.#nixos-anywhere -- --store-paths "$disko" "$next" --extra-files "$extra" "root@$node"
    ;;
  *) echo 'Unknown operation' >&2; exit 2 ;;
esac
