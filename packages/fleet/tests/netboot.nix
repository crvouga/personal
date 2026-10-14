{ pkgs, lib, installerNetboot, sopsModule, diskoModule }: let
  settings = import ../netboot.nix;
in pkgs.testers.runNixOSTest {
  name = "fleet-netboot";
  # No route to the fleet API in the VM: leave the agent out.
  node.specialArgs = { settings = settings // { fleetApi = { url = ""; }; }; installer = installerNetboot; };
  nodes.machine = {
    imports = [ sopsModule diskoModule ../hosts/netboot.nix ];
    disko.enableConfig = lib.mkForce false;
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
    environment.systemPackages = [ pkgs.curl ];
    virtualisation = { memorySize = 2048; cores = 2; };
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("multi-user.target")
    machine.wait_for_unit("pixiecore.service")
    machine.succeed("test -s /etc/fleet/netboot-kernel")
    machine.succeed("test -s /etc/fleet/netboot-initrd")
    machine.succeed("kernel=$(tr -d '\\n' < /etc/fleet/netboot-kernel); test -f \"$kernel\"")
    machine.succeed("initrd=$(tr -d '\\n' < /etc/fleet/netboot-initrd); test -f \"$initrd\"")
    machine.succeed("systemctl show -p ExecStart pixiecore | grep -F api")
    machine.succeed("systemctl show -p ExecStart pixiecore | grep -F 127.0.0.1:4012")
    machine.wait_for_unit("fleet-netboot-policy.service")
    machine.succeed("curl -fsS http://127.0.0.1:4012/health")
    machine.succeed("curl -fsS 'http://127.0.0.1:4012/fleet/choose?uuid=&mac=&role=' | grep -q exit")
    machine.fail("curl -fsS http://127.0.0.1:4012/v1/boot/not-a-mac")
  '';
}
