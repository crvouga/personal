{ config, lib, ... }: {
  # The driver has to be in the closure, so GPU is a role combination
  # (hosts/ci-gpu.nix), not a fact discovered from lspci on the plain ci image.
  # A legacy branch would be another module, still not a per-machine file.
  # This pin turns the driver on only when nvidia is a video driver. The X
  # server stays off. nix build .#nixosConfigurations.ci-gpu is opt-in;
  # the default CI build does not download the unfree driver.
  nixpkgs.config.allowUnfree = true;
  hardware.graphics.enable = true;
  hardware.nvidia = {
    open = lib.mkDefault true;
    modesetting.enable = true;
    nvidiaSettings = false;
    package = config.boot.kernelPackages.nvidiaPackages.stable;
  };
  services.xserver.enable = false;
  services.xserver.videoDrivers = [ "nvidia" ];
  environment.etc."self-hosting/capabilities.d/gpu".text = "gpu\n";
}
