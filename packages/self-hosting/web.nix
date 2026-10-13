# Web role settings. Do not point this at the CI fleet secret file or age key.
# CI hosts run untrusted pull-request code.
let shared = import ./settings/shared.nix;
in {
  role = "web";
  # TODO: add a profile under profiles/ if web hardware is not an MS-A2.
  profile = "ms-a2";
  # REQUIRED: identical model/path on every web node; obtain from the rescue system's /dev/disk/by-path.
  disk = "/dev/disk/by-path/TODO-internal-nvme";
  inherit (shared) sshKeys bootGenerationLimit repo binaryCache reboot;
  # TODO: encrypt secrets/web.yaml for this role's age key, then set secretsFile = ./secrets/web.yaml.
  # Never use secrets/fleet.yaml here.
  secretsFile = null;
  # One attrset per app. image is the OCI image CI already publishes (GHCR).
  # TODO: replace the placeholder with real apps. Do not guess domains or image tags.
  # {
  #   name = "portfolio";
  #   domain = "TODO";
  #   port = 8080; # localhost port Caddy proxies to
  #   containerPort = 80; # port inside the image
  #   image = "ghcr.io/TODO/TODO:TODO";
  #   envSecret = "portfolio-env"; # sops key in secrets/web.yaml; null if the app needs none
  # }
  apps = [
    {
      name = "placeholder";
      domain = "placeholder.example"; # TODO: real domain
      port = 8080;
      containerPort = 8080;
      image = null; # TODO: published image reference
      envSecret = null;
    }
  ];
}
