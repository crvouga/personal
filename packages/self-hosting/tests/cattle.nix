{ pkgs, lib, sopsModule, diskoModule }: let
  settings = import ../fleet.nix;
  testSettings = settings // {
    secretsFile = null;
    # Lowered so a small VM can show the high-mem tag. Production uses 60 GiB.
    capacity = {
      reserveGiB = 0;
      perRunnerGiB = 1;
      perRunnerCores = 2;
      slotMax = 4;
      highMemGiB = 2;
    };
    github = settings.github // { organization = "mock-org"; appId = "123"; installationId = "456"; };
  };
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
  nvmeDisk = pkgs.runCommand "cattle-nvme-disk" { } ''
    truncate -s 64M "$out"
  '';
  selectDisk = pkgs.writeShellScriptBin "select-disk" ''
    export PATH=${lib.makeBinPath [ pkgs.python3 pkgs.util-linux ]}:$PATH
    exec ${pkgs.python3}/bin/python3 ${../scripts/cattle.py} select-disk
  '';
  slotNames = map (n: "slot-${toString n}") (lib.range 1 testSettings.capacity.slotMax);
  machine = { config, ... }: {
    imports = [ sopsModule diskoModule ../hosts/ci.nix ];
    disko.enableConfig = lib.mkForce false;
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
    _module.args.registrationProvider = pkgs.writeShellScript "mock-registration" ''
      install -d -m 0700 /run/fleet/tokens
      printf 'mock-registration' > "$7"
      chmod 0600 "$7"
    '';
    services.github-runners = lib.genAttrs slotNames (_: { package = mock; });
    environment.systemPackages = [ selectDisk pkgs.curl pkgs.pciutils ];
  };
in pkgs.testers.runNixOSTest {
  name = "self-hosting-cattle";
  node.specialArgs = { settings = testSettings; };
  nodes.small = { config, ... }: {
    imports = [ machine ];
    virtualisation = {
      memorySize = 1536;
      cores = 2;
      # Extra e1000 on an empty hub. It must not get a second default route.
      qemu.options = [
        "-netdev" "hubport,id=extra0,hubid=1"
        "-device" "e1000,netdev=extra0"
      ];
    };
  };
  nodes.big = {
    imports = [ machine ];
    virtualisation = {
      memorySize = 4096;
      cores = 4;
      qemu.options = [
        "-drive" "if=none,id=nvmedisk,file=${nvmeDisk},format=raw"
        "-device" "nvme,drive=nvmedisk"
      ];
    };
  };
  testScript = ''
    start_all()
    small.wait_for_unit("multi-user.target")
    small.wait_for_unit("node-identity.service")
    small.wait_for_unit("fleet-capacity.service")
    small.wait_for_unit("github-runner-slot-1.service")
    small.fail("systemctl is-active --quiet github-runner-slot-2.service")
    small.succeed("hostname | grep -Eq '^ci-[0-9a-f]{4}$'")
    small.succeed("grep -qx 1 /run/fleet/slot-count")
    small.succeed("grep -qx x64 /run/self-hosting/runner-labels")
    small.fail("grep -qx high-mem /run/self-hosting/runner-labels")
    small.fail("grep -qx gpu /run/self-hosting/runner-labels")
    small.succeed("grep -qx \"hostname=$(hostname)\" /run/self-hosting/node")
    small.succeed("grep -qx capabilities= /run/self-hosting/node")
    small.succeed("grep -qx \"ACTIONS_RUNNER_INPUT_NAME=$(hostname)\" /run/fleet/identity")
    small.succeed("curl -fsS http://127.0.0.1:9101/metrics | grep -F \"hostname=\\\"$(hostname)\\\"\"")
    small.succeed("curl -fsS http://127.0.0.1:9101/metrics | grep -F 'role=\"ci\"'")
    small.succeed("lspci -nn | grep -q '8086:100e'")
    small.fail("select-disk | grep -q nvme")
    big.wait_for_unit("multi-user.target")
    big.wait_for_unit("fleet-capacity.service")
    big.wait_for_unit("github-runner-slot-1.service")
    big.wait_for_unit("github-runner-slot-2.service")
    big.fail("systemctl is-active --quiet github-runner-slot-3.service")
    big.succeed("hostname | grep -Eq '^ci-highmem-[0-9a-f]{4}$'")
    big.succeed("grep -qx 2 /run/fleet/slot-count")
    big.succeed("grep -qx high-mem /run/self-hosting/runner-labels")
    big.succeed("grep -qx x64 /run/self-hosting/runner-labels")
    big.fail("grep -qx gpu /run/self-hosting/runner-labels")
    big.succeed("grep -qx capabilities=highmem /run/self-hosting/node")
    big.succeed("lsblk -d -o TRAN | grep -qw nvme")
    big.succeed("select-disk | grep -q nvme")
    big.fail("lspci -nn | grep -q '8086:100e'")
  '';
}
