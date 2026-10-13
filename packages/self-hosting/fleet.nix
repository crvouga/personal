# Shared profile settings, never per-host configuration or plaintext credentials.
{
  profile = "ms-a2";
  # REQUIRED: identical model/path on every node; obtain from the rescue system’s /dev/disk/by-path.
  # A model-based nvme-eui path differs per node. Prefer a verified shared by-path
  # PCI slot path; do not guess it or use /dev/nvme0n1.
  disk = "/dev/disk/by-path/TODO-internal-nvme";
  sshKeys = [ ]; # REQUIRED: your work computer's public SSH key(s).
  github = {
    scope = "organization"; # or "repository"
    organization = "TODO";
    repositories = [ ]; # [ "owner/private-project" ]; slots are divided round-robin
    runnerGroup = null; # organization-only; operator configures private-only access
    appId = "TODO";
    installationId = "TODO";
  };
  # null: min(physical cores / 2, (RAM GiB - 4) / 6), at least one.
  slots = null;
  containers = false; # opt into rootless per-slot Podman and its Docker-compatible socket
  secretsFile = null; # set to ./secrets/fleet.yaml AFTER encrypting it
  cache = {
    maxGiB = 100;
    minFreeGiB = 30;
    remote = {
      enable = false;
      url = "s3://TODO?endpoint=TODO&region=auto";
      publicKey = "TODO";
    };
  };
  updates = {
    enable = false; # set URL, test SSH and rollbacks, then enable
    flake = "github:TODO/workspace/main?dir=packages/self-hosting";
    calendar = "*-*-* 04:00:00"; # UTC; deterministic hostname delay up to 2h
    drainTimeoutSeconds = 7200;
  };
}
