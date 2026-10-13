{ settings, ... }: {
  imports = [
    ../modules/base.nix
    ../modules/ci-runner.nix
    (../profiles + "/${settings.profile}.nix")
  ];
}
