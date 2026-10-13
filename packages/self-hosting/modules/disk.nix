{ settings, ... }: {
  disko.devices = {
    disk.internal = {
      type = "disk";
      device = settings.disk;
      content = { type = "gpt"; partitions = {
        ESP = { size = "1G"; type = "EF00";
          content = { type = "filesystem"; format = "vfat"; mountpoint = "/boot"; }; };
        nix = { size = "100%";
          content = { type = "filesystem"; format = "ext4"; mountpoint = "/nix"; }; };
      }; };
    };
    nodev."/" = { fsType = "tmpfs"; mountOptions = [ "size=50%" "mode=755" ]; };
  };
}
