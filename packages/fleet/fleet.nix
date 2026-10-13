# CI role settings, never per-host configuration or plaintext credentials.
let shared = import ./settings/shared.nix;
in {
  role = "ci";
  flakeAttr = "ci";
  inherit (shared) sshKeys bootGenerationLimit bootTries repo binaryCache capacity drift disk monitoring reinstall;
  # Set true only in the commit that adds the sops secret age-key-next.
  rotateAgeKey = false;
  reboot = shared.reboot // { drainCommand = "fleet-drain"; };
  github = {
    scope = "organization"; # or "repository"
    organization = "TODO";
    repositories = [ ]; # [ "owner/private-project" ]; slots are divided round-robin
    runnerGroup = null; # organization-only; operator configures private-only access
    appId = "TODO";
    installationId = "TODO";
  };
  containers = false; # opt into rootless per-slot Podman and its Docker-compatible socket
  secretsFile = null; # set to ./secrets/fleet.yaml AFTER encrypting it
  cache = {
    maxGiB = 100;
    minFreeGiB = 30;
    # Optional CI scratch store. This is not the fleet attic cache.
    remote = {
      enable = false;
      url = "s3://TODO?endpoint=TODO&region=auto";
      publicKey = "TODO";
    };
  };
}
