{ config, lib, pkgs, settings, ... }: {
  # Attic is off until this role has its own encrypted env file. The default
  # cache host still evaluates. Storage is bind-mounted from /nix because the
  # root filesystem is tmpfs and would drop the cache on every boot.
  config = lib.mkIf (settings.secretsFile != null) {
    systemd.tmpfiles.rules = [ "d /nix/fleet-state/attic 0755 root root -" ];
    fileSystems."/var/lib/atticd" = {
      device = "/nix/fleet-state/attic";
      fsType = "none";
      options = [ "bind" ];
    };
    networking.firewall.allowedTCPPorts = [ 8080 ];
    sops.secrets.attic-env = { mode = "0400"; };
    services.atticd = {
      enable = true;
      environmentFile = config.sops.secrets.attic-env.path;
      settings.listen = "[::]:8080";
    };
    environment.systemPackages = [ pkgs.attic-client ];
  };
}
