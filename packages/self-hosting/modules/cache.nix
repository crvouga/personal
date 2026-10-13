{ lib, pkgs, settings, ... }: let
  remote = settings.cache.remote;
  push = pkgs.writeShellScript "fleet-cache-push" ''
    set -eu
    export AWS_SHARED_CREDENTIALS_FILE=/run/secrets/cache-credentials
    for path in $OUT_PATHS; do
      ${pkgs.nix}/bin/nix store sign --key-file /run/secrets/cache-signing-key "$path"
      ${pkgs.nix}/bin/nix copy --to ${lib.escapeShellArg remote.url} "$path"
    done
  '';
in {
  nix.settings = lib.mkIf remote.enable {
    extra-substituters = [ remote.url ];
    extra-trusted-public-keys = [ remote.publicKey ];
    post-build-hook = push;
  };
  systemd.services.nix-daemon.environment = lib.mkIf remote.enable {
    AWS_SHARED_CREDENTIALS_FILE = "/run/secrets/cache-credentials";
    AWS_EC2_METADATA_DISABLED = "true";
  };
  systemd.services.fleet-cache-clean = {
    serviceConfig.Type = "oneshot";
    path = with pkgs; [ coreutils findutils util-linux ];
    script = ''
      set -eu
      exec 9>/run/fleet/gate
      flock 9
      free=$(df --output=avail -B1 /nix | tail -n1)
      used=$(du -sb /nix/ci-cache | cut -f1)
      if [ "$free" -lt ${toString (settings.cache.minFreeGiB * 1024 * 1024 * 1024)} ] ||
         [ "$used" -gt ${toString (settings.cache.maxGiB * 1024 * 1024 * 1024)} ]; then
        # Never remove a cache belonging to an active runner (including race with job start).
        for dir in /nix/ci-cache/slot-*; do
          slot=$(basename "$dir")
          if ! ${pkgs.systemd}/bin/systemctl is-active --quiet "github-runner-$slot.service"; then
            find "$dir" -mindepth 1 -delete
          fi
        done
        flock -u 9
        ${pkgs.nix}/bin/nix-collect-garbage --delete-older-than 14d
        free=$(df --output=avail -B1 /nix | tail -n1)
        if [ "$free" -lt ${toString (settings.cache.minFreeGiB * 1024 * 1024 * 1024)} ]; then
          echo 'Low disk space: preventing new runner starts; existing jobs continue.'
          touch /run/fleet/draining
          exit 1
        fi
      fi
    '';
  };
  systemd.timers.fleet-cache-clean = {
    wantedBy = [ "timers.target" ];
    timerConfig = { OnBootSec = "15min"; OnUnitActiveSec = "1h"; };
  };
}
