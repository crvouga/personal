{ lib, ... }: {
  image.fileName = "fleet-installer.iso";
  isoImage.makeEfiBootable = true;
  isoImage.makeUsbBootable = true;
  # The highlighted entry is ci. The menu waits 5 seconds, then that entry
  # boots. web, cache, and netboot are the other entries. Each specialisation
  # appends its own fleet.role=; the installer uses the last one.
  # iso-image.nix sets this to 10 at the same priority.
  boot.loader.timeout = lib.mkForce 5;
  boot.kernelParams = [ "fleet.role=ci" ];
  isoImage.appendToMenuLabel = lib.mkForce "";
  isoImage.configurationName = "ci";
  specialisation = lib.genAttrs [ "web" "cache" "netboot" ] (role: {
    configuration = {
      isoImage.configurationName = lib.mkForce role;
      boot.kernelParams = [ "fleet.role=${role}" ];
    };
  });
}
