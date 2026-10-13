{ lib, pkgs, ... }: {
  # Manufacturer: 9955HX 16C/32T; 32GiB initial profile. Runtime discovery
  # deliberately does not change the evaluated system closure.
  _module.args.hardware = { cores = 16; ramGiB = 32; };
  boot.kernelPackages = pkgs.linuxPackages_6_12;
  boot.initrd.availableKernelModules = [ "nvme" "xhci_pci" "ahci" ];
  boot.kernelModules = [ "kvm-amd" "r8169" "igc" "i40e" ];
  hardware.cpu.amd.updateMicrocode = lib.mkDefault true;
  hardware.enableRedistributableFirmware = true;
  # No unverified watchdog driver or speculative freeze workaround.
  # Confirm /dev/watchdog and watchdog identity on actual hardware.
}
