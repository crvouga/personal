{ pkgs, lib, installerNetboot, sopsModule, diskoModule }: let
  settings = import ../netboot.nix;
in pkgs.testers.runNixOSTest {
  name = "fleet-netboot";
  node.specialArgs = { inherit settings; installer = installerNetboot; };
  nodes.machine = {
    imports = [ sopsModule diskoModule ../hosts/netboot.nix ];
    disko.enableConfig = lib.mkForce false;
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
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
    machine.succeed("kernel=$(tr -d '\\n' < /etc/fleet/netboot-kernel); systemctl show -p ExecStart pixiecore | grep -F \"$kernel\"")
  '';
}
