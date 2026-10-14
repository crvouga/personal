# Cache role settings. Do not point this at the CI or web age key or secret file.
let shared = import ./settings/shared.nix;
in {
  role = "cache";
  flakeAttr = "cache";
  inherit (shared) sshKeys bootGenerationLimit bootTries repo binaryCache reboot capacity drift disk monitoring reinstall;
  rotateAgeKey = false;
  # TODO: encrypt secrets/cache.yaml for this role's age key, then set this.
  # The file needs attic-env (the server env file) and, when repo.auth is set,
  # git-read-key or git-read-token. Never use secrets/fleet.yaml or secrets/web.yaml.
  secretsFile = null;
}
