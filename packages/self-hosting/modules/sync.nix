{ config, lib, pkgs, settings, ... }: let
  repo = settings.repo;
  configured = !(lib.hasInfix "TODO" repo.url);
  timerOn = (repo.timer or true) && configured;
  auth = repo.auth or "none";
  gitKey = if auth == "ssh" then config.sops.secrets.git-read-key.path else "";
  gitToken = if auth == "token" then config.sops.secrets.git-read-token.path else "";
in {
  # comin is not in nixpkgs at the pinned revision 7c8764b7, so this timer is
  # the pull agent. It fetches one branch and switches nixosConfigurations.<flakeAttr>.
  # track is deploy or canary in this closure. It is not a MAC.
  assertions = [
    {
      assertion = auth == "none" || settings.secretsFile != null;
      message = "repo.auth needs this role's secretsFile. CI and web must not share that file or its age key.";
    }
  ];
  environment.systemPackages = [
    (pkgs.writeShellScriptBin "fleet-sync" ''
      exec ${pkgs.bash}/bin/bash ${../scripts/fleet-sync.sh} "$@"
    '')
  ];
  environment.etc."self-hosting/git-known-hosts".source = ./github-known-hosts;
  environment.etc."self-hosting/sync.env".text = ''
    ROLE=${lib.escapeShellArg settings.role}
    FLAKE_ATTR=${lib.escapeShellArg settings.flakeAttr}
    TRACK=${lib.escapeShellArg settings.track}
    REPO_URL=${lib.escapeShellArg repo.url}
    DEPLOY_BRANCH=${lib.escapeShellArg repo.deployBranch}
    CANARY_BRANCH=${lib.escapeShellArg repo.canaryBranch}
    FLAKE_DIR=${lib.escapeShellArg repo.flakeDir}
    DELAY_MAX=${toString settings.reboot.delayMaxSeconds}
    DRAIN_COMMAND=${lib.escapeShellArg settings.reboot.drainCommand}
    DRAIN_TIMEOUT=${toString settings.reboot.drainTimeoutSeconds}
    GIT_KEY=${lib.escapeShellArg gitKey}
    GIT_TOKEN=${lib.escapeShellArg gitToken}
    GIT_KNOWN_HOSTS=${lib.escapeShellArg "/etc/self-hosting/git-known-hosts"}
    FLEET_NIX=${lib.escapeShellArg (settings.fleetNix or "${pkgs.nix}/bin/nix")}
    FLEET_NIX_ENV=${lib.escapeShellArg (settings.fleetNixEnv or "${pkgs.nix}/bin/nix-env")}
    FLEET_SYSTEMCTL=${lib.escapeShellArg (settings.fleetSystemctl or "${pkgs.systemd}/bin/systemctl")}
    FLEET_GIT=${lib.escapeShellArg "${pkgs.git}/bin/git"}
    CATTLE_PY=${lib.escapeShellArg "${../scripts/cattle.py}"}
    PYTHON=${lib.escapeShellArg "${pkgs.python3}/bin/python3"}
  '';
  sops.secrets = lib.mkIf (settings.secretsFile != null) (lib.mkMerge [
    (lib.mkIf (auth == "ssh") { git-read-key = { mode = "0400"; }; })
    (lib.mkIf (auth == "token") { git-read-token = { mode = "0400"; }; })
  ]);
  systemd.services.fleet-sync = {
    description = "Pull this role from git";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    # path replaces the unit PATH. awk is gawk, not coreutils.
    path = [ pkgs.git pkgs.openssh pkgs.coreutils pkgs.gawk pkgs.nix pkgs.python3 ];
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.bash}/bin/bash ${../scripts/fleet-sync.sh}";
    };
    unitConfig.X-StopOnRemoval = false;
  };
  systemd.timers.fleet-sync = lib.mkIf timerOn {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "2min";
      OnUnitActiveSec = "${toString repo.pollSeconds}s";
      Persistent = true;
      RandomizedDelaySec = "30s";
    };
  };
}
