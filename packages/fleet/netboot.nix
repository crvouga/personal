# Netboot role settings. This host serves the installer. It does not use CI or web secrets.
let shared = import ./settings/shared.nix;
in {
  role = "netboot";
  flakeAttr = "netboot";
  inherit (shared) sshKeys bootGenerationLimit repo binaryCache reboot capacity drift;
  # TODO: encrypt secrets/netboot.yaml for this role's age key when repo.auth is set.
  secretsFile = null;
}
