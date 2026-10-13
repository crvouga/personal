{ pkgs, lib, sopsModule, diskoModule }: let
  settings = import ../fleet.nix;
  mockNix = pkgs.writeShellScriptBin "nix" ''
    set -euo pipefail
    jobs=""
    prev=""
    flake=""
    for arg in "$@"; do
      if [ "$prev" = "--max-jobs" ]; then jobs=$arg; fi
      prev=$arg
      case "$arg" in
        path:*) flake=$arg ;;
      esac
    done
    # A missing --max-jobs 0 means the sync script tried to build locally.
    [ "$jobs" = 0 ]
    [ -n "$flake" ]
    checkout=''${flake#path:}
    checkout=''${checkout%%#*}
    if [ -f "$checkout/NOT_IN_CACHE" ]; then
      echo 'not in cache' >&2
      exit 1
    fi
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
  mockHealth = pkgs.writeShellScript "fleet-health" ''
    exit 0
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
    fleetHealth = "${mockHealth}";
    repo = settings.repo // {
      url = "file:///tmp/origin";
      timer = false;
    };
    reboot = settings.reboot // {
      delayMaxSeconds = 0;
      drainCommand = "${drain}/bin/drain";
    };
    binaryCache = {
      url = "https://cache.invalid/fleet";
      publicKey = "cache.invalid-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    };
  };
in pkgs.testers.runNixOSTest {
  name = "fleet-lifecycle";
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
    machine.succeed("grep -qx lifecycle-rev /etc/fleet/revision")
    machine.succeed("grep -F 'https://cache.invalid/fleet' /etc/nix/nix.conf")
    machine.succeed("grep -F 'cache.invalid-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' /etc/nix/nix.conf")
    machine.fail("systemctl is-active --quiet fleet-sync.timer")
    machine.succeed(r"""
      set -euo pipefail
      install -d /tmp/origin/packages/fleet /run/fleet-sync
      git init -b main /tmp/origin
      git -C /tmp/origin config user.email test@example.invalid
      git -C /tmp/origin config user.name test
      echo waiting > /tmp/origin/packages/fleet/marker
      touch /tmp/origin/packages/fleet/NOT_IN_CACHE
      git -C /tmp/origin add packages
      git -C /tmp/origin commit -m 'cache miss'
    """)
    machine.fail("fleet-sync")
    machine.succeed(r"""
      set -euo pipefail
      test ! -e /nix/var/nix/profiles/system
      curl -fsS http://127.0.0.1:9101/metrics | grep -F 'revision="lifecycle-rev"'
      rm /tmp/origin/packages/fleet/NOT_IN_CACHE
      echo main-b > /tmp/origin/packages/fleet/marker
      git -C /tmp/origin add packages
      git -C /tmp/origin commit -m main-b
      git -C /tmp/origin rev-parse HEAD > /tmp/main-b
      fleet-sync
      applied=$(cat "$(readlink -f /nix/var/nix/profiles/system)/commit")
      test "$applied" = "$(cat /tmp/main-b)"
      grep -qx switch /run/fleet-sync/operations
      test ! -e /run/fleet-sync/actions
      ln -sfn "$(readlink -f /nix/var/nix/profiles/system)" /run/booted-system
      echo kernel > /tmp/origin/packages/fleet/KERNEL_CHANGE
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
