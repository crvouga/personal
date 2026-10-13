{ installer, lib, ... }: let
  kernel = "${installer.config.system.build.kernel}/${installer.config.system.boot.loader.kernelFile}";
  initrd = "${installer.config.system.build.netbootRamdisk}/initrd";
  cmdline = "init=${installer.config.system.build.toplevel}/init ${toString installer.config.boot.kernelParams}";
in {
  # Serve the same installer module the USB ISO uses. dhcpNoBind keeps this
  # host from replacing an existing DHCP server; it still answers ProxyDHCP
  # and serves the kernel over TFTP and HTTP. Set services.pixiecore.dhcpNoBind
  # to false only on a network whose DHCP server this host is meant to be.
  services.pixiecore = {
    enable = true;
    openFirewall = true;
    mode = "boot";
    dhcpNoBind = lib.mkDefault true;
    inherit kernel initrd;
    cmdLine = cmdline;
  };
  environment.etc."self-hosting/netboot-kernel".text = kernel + "\n";
  environment.etc."self-hosting/netboot-initrd".text = initrd + "\n";
}
