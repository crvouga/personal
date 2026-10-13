# Cache role settings. Do not point this at the CI or web age key or secret file.
let shared = import ./settings/shared.nix;
in {
  role = "cache";
  # TODO: add a profile under profiles/ if this hardware is not an MS-A2.
  profile = "ms-a2";
  # REQUIRED: identical model/path on every cache node. Do not guess it.
  disk = "/dev/disk/by-path/TODO-internal-nvme";
  inherit (shared) sshKeys bootGenerationLimit repo binaryCache reboot;
  # TODO: encrypt secrets/cache.yaml for this role's age key, then set this.
  # The file needs attic-env (the server env file) and, when repo.auth is set,
  # git-read-key or git-read-token. Never use secrets/fleet.yaml or secrets/web.yaml.
  secretsFile = null;
}
