{ pkgs, lib, sopsModule, diskoModule }: let
  settings = import ../fleet.nix;
  mockNix = pkgs.writeShellScriptBin "nix" ''
    set -euo pipefail
    flake=""
    for arg in "$@"; do
      case "$arg" in
        path:*) flake=$arg ;;
      esac
    done
    [ -n "$flake" ]
    checkout=''${flake#path:}
    checkout=''${checkout%%#*}
    rev=$(${pkgs.git}/bin/git -C "$checkout" rev-parse HEAD)
    kernel_file=$(mktemp)
    if [ -f "$checkout/KERNEL_CHANGE" ]; then
      printf 'changed-%s\n' "$rev" > "$kernel_file"
    else
      printf 'same\n' > "$kernel_file"
    fi
    kernel_store=$(${pkgs.nix}/bin/nix-store --add "$kernel_file")
    work=$(mktemp -d)
    mkdir -p "$work/bin"
    ln -s "$kernel_store" "$work/kernel"
    ln -s "$kernel_store" "$work/initrd"
    ln -s "$kernel_store" "$work/kernel-modules"
    printf '%s\n' "$rev" > "$work/commit"
    cat > "$work/bin/switch-to-configuration" <<'EOF'
#!/bin/bash
install -d -m 0755 /run/fleet-sync
printf '%s\n' "$1" >> /run/fleet-sync/operations
EOF
    chmod +x "$work/bin/switch-to-configuration"
    ${pkgs.nix}/bin/nix-store --add "$work"
  '';
  mockSystemctl = pkgs.writeShellScriptBin "systemctl" ''
    install -d -m 0755 /run/fleet-sync
    if [ "$1" = "reboot" ]; then
      echo reboot >> /run/fleet-sync/actions
    fi
    exit 0
  '';
  drain = pkgs.writeShellScriptBin "drain" ''
    install -d -m 0755 /run/fleet-sync
    echo drain >> /run/fleet-sync/actions
    if [ -f /run/fleet-sync/fail-drain ]; then
      exit 1
    fi
  '';
  testSettings = settings // {
    secretsFile = null;
    fleetNix = "${mockNix}/bin/nix";
    fleetSystemctl = "${mockSystemctl}/bin/systemctl";
    repo = settings.repo // {
      url = "file:///tmp/origin";
      timer = false;
    };
    reboot = settings.reboot // {
      delayMaxSeconds = 0;
      drainCommand = "${drain}/bin/drain";
    };
    binaryCache = {
      url = "https://cache.invalid/self-hosting";
      publicKey = "cache.invalid-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    };
  };
in pkgs.testers.runNixOSTest {
  name = "self-hosting-lifecycle";
  node.specialArgs = { settings = testSettings; revision = "lifecycle-rev"; };
  nodes.machine = {
    imports = [ sopsModule diskoModule ../modules/base.nix ];
    disko.enableConfig = lib.mkForce false;
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
    environment.systemPackages = [ pkgs.curl pkgs.git ];
    virtualisation = { memorySize = 2048; cores = 2; writableStore = true; };
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("multi-user.target")
    machine.wait_for_unit("fleet-revision.service")
    machine.succeed("curl -fsS http://127.0.0.1:9101/metrics | grep -F 'revision=\"lifecycle-rev\"'")
    machine.succeed("grep -qx lifecycle-rev /etc/self-hosting/revision")
    machine.succeed("grep -F 'https://cache.invalid/self-hosting' /etc/nix/nix.conf")
    machine.succeed("grep -F 'cache.invalid-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' /etc/nix/nix.conf")
    machine.fail("systemctl is-active --quiet fleet-sync.timer")
    machine.succeed(r"""
      set -euo pipefail
      install -d /tmp/origin/packages/self-hosting /run/fleet-sync
      git init -b deploy /tmp/origin
      git -C /tmp/origin config user.email test@example.invalid
      git -C /tmp/origin config user.name test
      echo deploy-a > /tmp/origin/packages/self-hosting/marker
      git -C /tmp/origin add packages
      git -C /tmp/origin commit -m deploy-a
      git -C /tmp/origin branch canary
      git -C /tmp/origin checkout canary
      echo canary-b > /tmp/origin/packages/self-hosting/marker
      git -C /tmp/origin commit -am canary-b
      git -C /tmp/origin checkout deploy
      git -C /tmp/origin rev-parse deploy > /tmp/deploy-a
      git -C /tmp/origin rev-parse canary > /tmp/canary-b
      fleet-sync
      applied=$(cat "$(readlink -f /nix/var/nix/profiles/system)/commit")
      test "$applied" = "$(cat /tmp/deploy-a)"
      grep -qx switch /run/fleet-sync/operations
      test ! -e /run/fleet-sync/actions
      sed "s/^TRACK=.*/TRACK='canary'/" /etc/self-hosting/sync.env > /tmp/canary.env
      SYNC_ENV=/tmp/canary.env fleet-sync
      applied=$(cat "$(readlink -f /nix/var/nix/profiles/system)/commit")
      test "$applied" = "$(cat /tmp/canary-b)"
      ln -sfn "$(readlink -f /nix/var/nix/profiles/system)" /run/booted-system
      git -C /tmp/origin checkout deploy
      echo kernel > /tmp/origin/packages/self-hosting/KERNEL_CHANGE
      git -C /tmp/origin add packages
      git -C /tmp/origin commit -m kernel
      : > /run/fleet-sync/actions
      touch /run/fleet-sync/fail-drain
    """)
    machine.fail("fleet-sync")
    machine.succeed(r"""
      set -euo pipefail
      grep -qx drain /run/fleet-sync/actions
      if grep -qx reboot /run/fleet-sync/actions; then
        echo 'reboot ran after a failed drain' >&2
        exit 1
      fi
      rm /run/fleet-sync/fail-drain
      : > /run/fleet-sync/actions
      fleet-sync
      grep -qx drain /run/fleet-sync/actions
      grep -qx reboot /run/fleet-sync/actions
      drain_line=$(awk -F: '/^drain$/ { print NR; exit }' /run/fleet-sync/actions)
      reboot_line=$(awk -F: '/^reboot$/ { print NR; exit }' /run/fleet-sync/actions)
      test "$drain_line" -lt "$reboot_line"
      grep -qx boot /run/fleet-sync/operations
    """)
  '';
}
