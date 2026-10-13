{ pkgs, lib, settings, sopsModule, diskoModule }: let
  mock = pkgs.callPackage ({ nodeRuntimes ? [] }: pkgs.runCommand "mock-github-runner" {} ''
    mkdir -p $out/bin
    cat > $out/bin/Runner.Listener <<'MOCK'
#!${pkgs.bash}/bin/bash
set -eu
case "$1" in
  configure)
    test -s "$RUNNER_ROOT/.new-token"
    test -n "$ACTIONS_RUNNER_INPUT_NAME"
    for name in .credentials .credentials_rsaparams .runner; do
      printf '{}' > "$RUNNER_ROOT/$name"
    done
    ;;
  run) exec ${pkgs.coreutils}/bin/sleep infinity ;;
  *) exit 2 ;;
esac
MOCK
    chmod +x $out/bin/Runner.Listener
  '') {};
  testSettings = settings // {
    slots = 2; secretsFile = null;
    github = settings.github // { organization = "mock-org"; appId = "123"; installationId = "456"; };
    cache = settings.cache // { remote = settings.cache.remote // { enable = false; }; };
  };
in pkgs.testers.runNixOSTest {
  name = "self-hosting";
  # hosts/ci.nix picks the hardware profile while resolving imports.
  node.specialArgs = { settings = testSettings; };
  nodes.machine = { config, ... }: {
    imports = [ sopsModule diskoModule ../hosts/ci.nix ];
    # The VM root is the test image. Disko still evaluates, but must not mount the host disk layout.
    disko.enableConfig = lib.mkForce false;
    _module.args = {
      hardware = { cores = 16; ramGiB = 32; };
      registrationProvider = pkgs.writeShellScript "mock-registration" ''
        install -d -m 0700 /run/fleet/tokens
        printf 'mock-registration' > "$7"
        chmod 0600 "$7"
      '';
      # writeShellScriptBin is /bin/sh. compgen is bash-only, and a missing
      # command here was ignored, so a busy slot still looked drained.
      drainProvider = pkgs.writeShellScriptBin "runner-control" ''
        for busy in /run/fleet/*/busy; do
          [ -e "$busy" ] && exit 1
        done
        exit 0
      '';
    };
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
    services.github-runners = lib.genAttrs [ "slot-1" "slot-2" ] (_: { package = mock; });
    environment.etc."ci-fleet-vm-test".text = ''
      firewall=${lib.boolToString config.networking.firewall.enable}
      sshPorts=${lib.concatStringsSep "," (map toString config.networking.firewall.allowedTCPPorts)}
      nixLd=${lib.boolToString config.programs.nix-ld.enable}
      watchdog=${config.systemd.settings.Manager.RuntimeWatchdogSec}
    '';
    # Test persistence and disposable root without touching a physical disk.
    virtualisation = { memorySize = 3072; cores = 2; writableStore = true; };
  };
  nodes.client = { pkgs, ... }: { environment.systemPackages = [ pkgs.netcat-openbsd ]; };
  # The guest hostname is the NIC MAC, so the other node is reached by address.
  testScript = { nodes, ... }: ''
    start_all()
    machine.wait_for_unit("multi-user.target")
    machine.wait_for_unit("github-runner-slot-1.service")
    machine.wait_for_unit("github-runner-slot-2.service")
    machine.succeed("hostname | grep -Eq '^ci-[0-9a-f]{12}$'")
    machine.succeed("grep -Eq '^ACTIONS_RUNNER_INPUT_NAME=ci-[0-9a-f]{12}$' /run/fleet/identity")
    machine.succeed("test -d /nix/ci-cache/slot-1 && test -d /nix/ci-cache/slot-2")
    machine.succeed("grep -qx nixLd=true /etc/ci-fleet-vm-test && test -e /run/current-system/sw/share/nix-ld/lib/ld.so")
    machine.succeed("grep -qx watchdog=30s /etc/ci-fleet-vm-test")
    machine.succeed("grep -qx firewall=true /etc/ci-fleet-vm-test && grep -qx sshPorts=22 /etc/ci-fleet-vm-test")
    client.wait_for_unit("multi-user.target")
    client.succeed("nc -z -w 5 ${nodes.machine.networking.primaryIPAddress} 22")
    machine.succeed("${pkgs.python3}/bin/python3 -m http.server 8765 --bind 0.0.0.0 >/tmp/firewall-probe.log 2>&1 &")
    machine.wait_for_open_port(8765)
    client.fail("nc -z -w 2 ${nodes.machine.networking.primaryIPAddress} 8765")
    machine.succeed("systemctl show -p RuntimeWatchdogUSec | grep '30s'")
    machine.succeed("su -s /bin/sh slot-1 -c 'echo disposable >/nix/ci-cache/slot-1/probe'")
    machine.fail("su -s /bin/sh slot-2 -c 'cat /nix/ci-cache/slot-1/probe'")
    machine.succeed("sshd -G -T -f /etc/ssh/sshd_config | grep -i '^passwordauthentication no$'")
    machine.succeed("test $(id -u slot-1) != $(id -u slot-2)")
    machine.succeed("test $(stat -c %a /run/fleet/tokens/slot-1) = 600")
    machine.succeed("fleet-drain 30")
    machine.fail("systemctl is-active --quiet github-runner-slot-1.service")
    machine.succeed("fleet-resume")
    machine.wait_for_unit("github-runner-slot-1.service")
    # Busy jobs must not be stopped at timeout; deployment must be blocked.
    machine.succeed("touch /run/fleet/slot-1/busy")
    machine.fail("fleet-drain 30")
    machine.succeed("systemctl is-active --quiet github-runner-slot-1.service")
    machine.succeed("rm /run/fleet/slot-1/busy; fleet-resume")
    machine.fail("grep -F cache.invalid /etc/nix/nix.conf")
  '';
}
