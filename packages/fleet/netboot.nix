# Netboot role settings. This host does not serve an installer that can finish an install. It does not use CI or web secrets.
let shared = import ./settings/shared.nix;
in {
  role = "netboot";
  flakeAttr = "netboot";
  inherit (shared) sshKeys bootGenerationLimit bootTries repo binaryCache reboot capacity drift disk monitoring reinstall fleetApi;
  rotateAgeKey = false;
  # TODO: encrypt secrets/netboot.yaml for this role's age key when repo.auth is set.
  secretsFile = null;
}
