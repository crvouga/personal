# Netboot role settings. This host serves the installer. It does not use CI or web secrets.
let shared = import ./settings/shared.nix;
in {
  role = "netboot";
  # TODO: add a profile under profiles/ if this hardware is not an MS-A2.
  profile = "ms-a2";
  # REQUIRED: identical model/path on every netboot node. Do not guess it.
  disk = "/dev/disk/by-path/TODO-internal-nvme";
  inherit (shared) sshKeys bootGenerationLimit repo binaryCache reboot;
  # TODO: encrypt secrets/netboot.yaml for this role's age key when repo.auth is set.
  secretsFile = null;
}
