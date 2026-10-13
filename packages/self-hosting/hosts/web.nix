{ settings, ... }: {
  imports = [
    ../modules/base.nix
    ../modules/web-server.nix
    (../profiles + "/${settings.profile}.nix")
  ];
}
