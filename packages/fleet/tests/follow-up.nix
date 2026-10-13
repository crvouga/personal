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
    [ "$jobs" = 0 ]
    [ -n "$flake" ]
    checkout=''${flake#path:}
    checkout=''${checkout%%#*}
    rev=$(${pkgs.git}/bin/git -C "$checkout" rev-parse HEAD)
    kernel_file=$(mktemp)
    printf 'same\n' > "$kernel_file"
    kernel_store=$(${pkgs.nix}/bin/nix-store --add "$kernel_file")
    # nix-store --add garbage-collects on exit. Nothing roots this object yet,
    # so that collection deletes it and the toplevel symlink dangles. [ -e ]
    # on a dangling symlink is false, and fleet-sync then skips the reboot
    # check. Root it before the toplevel add. The path file is a real
    # reference so the generation keeps the object after this process exits.
    mkdir -p /nix/var/nix/gcroots
    ln -sfn "$kernel_store" "/nix/var/nix/gcroots/''${kernel_store##*/}"
    work=$(mktemp -d)
    mkdir -p "$work/bin"
    ln -s "$kernel_store" "$work/kernel"
    ln -s "$kernel_store" "$work/initrd"
    ln -s "$kernel_store" "$work/kernel-modules"
    printf '%s\n' "$kernel_store" > "$work/kernel-path"
    printf '%s\n' "$rev" > "$work/commit"
    # The guest has /bin/sh. /bin/bash is absent, and a missing interpreter exits 126.
    cat > "$work/bin/switch-to-configuration" <<'EOF'
#!/bin/sh
install -d -m 0755 /run/fleet-sync
printf '%s\n' "$1" >> /run/fleet-sync/operations
EOF
    chmod +x "$work/bin/switch-to-configuration"
    toplevel=$(${pkgs.nix}/bin/nix-store --add "$work")
    test -e "$toplevel/kernel"
    test -e "$toplevel/initrd"
    test -e "$toplevel/kernel-modules"
    printf '%s\n' "$toplevel"
  '';
  mockHealth = pkgs.writeShellScript "fleet-health" ''
    if [ -f /run/fleet-sync/fail-health ]; then
      echo 'health failed' >&2
      exit 1
    fi
    exit 0
  '';
  testSettings = settings // {
    secretsFile = null;
    fleetNix = "${mockNix}/bin/nix";
    fleetHealth = "${mockHealth}";
    repo = settings.repo // {
      url = "file:///tmp/origin";
      timer = false;
    };
    reboot = settings.reboot // { delayMaxSeconds = 0; };
    binaryCache = {
      url = "https://cache.invalid/fleet";
      publicKey = "cache.invalid-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    };
  };
in pkgs.testers.runNixOSTest {
  name = "fleet-follow-up";
  node.specialArgs = { settings = testSettings; revision = "follow-up-rev"; };
  nodes.machine = {
    imports = [ sopsModule diskoModule ../modules/base.nix ];
    disko.enableConfig = lib.mkForce false;
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
    environment.systemPackages = [ pkgs.git ];
    virtualisation = { memorySize = 2048; cores = 2; writableStore = true; };
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("multi-user.target")
    machine.succeed("systemctl cat fleet-sync.service")
    machine.succeed(r"""
      set -euo pipefail
      install -d /tmp/origin/packages/fleet /run/fleet-sync
      git init -b main /tmp/origin
      git -C /tmp/origin config user.email test@example.invalid
      git -C /tmp/origin config user.name test
      echo a > /tmp/origin/packages/fleet/marker
      git -C /tmp/origin add packages
      git -C /tmp/origin commit -m a
      git -C /tmp/origin rev-parse HEAD > /tmp/commit-a
      # The harness symlink is this VM's own generation. These switches have
      # no previous fleet generation, so a live kernel must not force a reboot.
      rm -f /run/booted-system
      fleet-sync
      applied=$(cat "$(readlink -f /nix/var/nix/profiles/system)/commit")
      test "$applied" = "$(cat /tmp/commit-a)"
      echo b > /tmp/origin/packages/fleet/marker
      git -C /tmp/origin add packages
      git -C /tmp/origin commit -m b
      git -C /tmp/origin rev-parse HEAD > /tmp/commit-b
      fleet-sync
      applied=$(cat "$(readlink -f /nix/var/nix/profiles/system)/commit")
      test "$applied" = "$(cat /tmp/commit-b)"
      test "$applied" != "$(cat /tmp/commit-a)"
      systemctl cat fleet-sync.service >/dev/null
      touch /run/fleet-sync/fail-health
      echo c > /tmp/origin/packages/fleet/marker
      git -C /tmp/origin add packages
      git -C /tmp/origin commit -m c
    """)
    machine.fail("fleet-sync")
    machine.succeed(r"""
      set -euo pipefail
      applied=$(cat "$(readlink -f /nix/var/nix/profiles/system)/commit")
      test "$applied" = "$(cat /tmp/commit-b)"
      test -s /run/fleet/health-failure
      grep -q 'mode=switch' /run/fleet/health-failure
      test "$(grep -c switch /run/fleet-sync/operations)" -ge 2
    """)
  '';
}
