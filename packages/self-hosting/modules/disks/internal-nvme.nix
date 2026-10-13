{ settings, ... }: {
  # EFI plus persistent /nix. The root is tmpfs, so an install leaves nothing
  # from the previous OS, including Windows. Every node of a role uses the path
  # in that role's settings, so the partition table is the same every time.
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
