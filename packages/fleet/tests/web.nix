{ pkgs, lib, sopsModule, diskoModule }: let
  settings = import ../web.nix;
in pkgs.testers.runNixOSTest {
  name = "fleet-web";
  # No route to the fleet API in the VM: leave the agent out.
  node.specialArgs = { settings = settings // { fleetApi = { url = ""; }; }; };
  nodes.web = { config, pkgs, ... }: {
    imports = [ sopsModule diskoModule ../hosts/web.nix ];
    disko.enableConfig = lib.mkForce false;
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
    environment.systemPackages = [ pkgs.curl ];
    virtualisation = { memorySize = 2048; cores = 2; };
    environment.etc."web-role-firewall".text =
      lib.concatStringsSep "," (map toString (lib.sort (a: b: a < b) config.networking.firewall.allowedTCPPorts));
  };
  nodes.client = { pkgs, ... }: { environment.systemPackages = [ pkgs.curl pkgs.netcat-openbsd ]; };
  testScript = { nodes, ... }: ''
    start_all()
    web.wait_for_unit("multi-user.target")
    web.wait_for_unit("node-identity.service")
    web.wait_for_unit("web-app-placeholder.service")
    web.wait_for_unit("caddy.service")
    web.succeed("hostname | grep -Eq '^web-[0-9a-f]{4}$'")
    web.fail("test -e /run/fleet/identity")
    web.fail("systemctl list-unit-files --no-legend | grep -q '^github-runner-'")
    web.succeed("grep -qx '22,80,443' /etc/web-role-firewall")
    web.wait_until_succeeds("curl -kfsS --resolve placeholder.example:443:127.0.0.1 https://placeholder.example/ | grep -qx placeholder-ok")
    client.wait_for_unit("multi-user.target")
    client.succeed("curl -kfsS --resolve placeholder.example:443:${nodes.web.networking.primaryIPAddress} https://placeholder.example/ | grep -qx placeholder-ok")
    client.succeed("nc -z -w 5 ${nodes.web.networking.primaryIPAddress} 22")
    client.succeed("nc -z -w 5 ${nodes.web.networking.primaryIPAddress} 80")
    client.fail("nc -z -w 2 ${nodes.web.networking.primaryIPAddress} 8080")
  '';
}
