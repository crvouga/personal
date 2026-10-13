{ lib, ... }: {
  image.fileName = "fleet-installer.iso";
  isoImage.makeEfiBootable = true;
  isoImage.makeUsbBootable = true;
  # The highlighted entry is ci. The menu waits 5 seconds, then that entry
  # boots. web, cache, and netboot are the other entries. Each specialisation
  # appends its own fleet.role=; the installer uses the last one.
  boot.loader.timeout = 5;
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
