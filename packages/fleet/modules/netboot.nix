{ installer, lib, pkgs, settings, ... }: let
  kernel = "${installer.config.system.build.kernel}/${installer.config.system.boot.loader.kernelFile}";
  initrd = "${installer.config.system.build.netbootRamdisk}/initrd";
  cmdline = "init=${installer.config.system.build.toplevel}/init ${toString installer.config.boot.kernelParams}";
  policyPort = 4012;
in {
  # Firmware boots the network first (one-time BIOS setup). This host's
  # default answer is the local disk. A stable id or a role listed in
  # settings.reinstall is served the shared installer instead. dhcpNoBind
  # keeps this host from replacing an existing DHCP server.
  services.pixiecore = {
    enable = true;
    openFirewall = true;
    mode = "api";
    dhcpNoBind = lib.mkDefault true;
    apiServer = "http://127.0.0.1:${toString policyPort}";
  };
  networking.firewall.allowedTCPPorts = [ policyPort ];
  environment.etc."fleet/netboot-kernel".text = kernel + "\n";
  environment.etc."fleet/netboot-initrd".text = initrd + "\n";
  environment.etc."fleet/netboot-cmdline".text = cmdline + "\n";
  environment.etc."fleet/reinstall.json".text = builtins.toJSON {
    nodes = settings.reinstall.nodes;
    roles = settings.reinstall.roles;
  };
  systemd.services.fleet-netboot-policy = {
    description = "Choose the installer or the local disk for netboot clients";
    wantedBy = [ "multi-user.target" ];
    after = [ "network.target" ];
    serviceConfig = {
      ExecStart = "${pkgs.python3}/bin/python3 ${../scripts/netboot-policy.py}";
      Environment = [
        "FLEET_NETBOOT_PORT=${toString policyPort}"
        "FLEET_POLICY=/etc/fleet/reinstall.json"
        "FLEET_KERNEL_FILE=/etc/fleet/netboot-kernel"
        "FLEET_INITRD_FILE=/etc/fleet/netboot-initrd"
        "FLEET_CMDLINE_FILE=/etc/fleet/netboot-cmdline"
      ];
      DynamicUser = true;
      Restart = "on-failure";
    };
  };
  systemd.services.pixiecore = {
    after = [ "fleet-netboot-policy.service" ];
    requires = [ "fleet-netboot-policy.service" ];
  };
}
