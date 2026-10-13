{ settings, ... }: {
  imports = [
    ../modules/base.nix
    ../modules/netboot.nix
    (../profiles + "/${settings.profile}.nix")
  ];
}
