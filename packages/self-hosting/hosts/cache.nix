{ settings, ... }: {
  imports = [
    ../modules/base.nix
    ../modules/cache-server.nix
    (../profiles + "/${settings.profile}.nix")
  ];
}
