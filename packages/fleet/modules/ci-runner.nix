{ lib, pkgs, settings, ... }: {
  imports = [ ./runners.nix ./cache.nix ];
  _module.args.registrationProvider = lib.mkDefault null;
  _module.args.drainProvider = lib.mkDefault null;
  programs.nix-ld.enable = true;
  virtualisation.podman = lib.mkIf settings.containers { enable = true; dockerCompat = true; };
  # Start slot-1..slot-N from the boot-time count. The other units exist in
  # this closure and stay stopped. systemctl start is synchronous enough that
  # multi-user waits until those units have been started.
  systemd.services.fleet-capacity = {
    description = "Start the runner slots this machine can hold";
    wantedBy = [ "multi-user.target" ];
    after = [ "node-identity.service" ];
    requires = [ "node-identity.service" ];
    path = [ pkgs.systemd pkgs.coreutils ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    script = ''
      count=$(tr -d '[:space:]' < /run/fleet/slot-count)
      case "$count" in
        ""|*[!0-9]*) echo 'slot count is not a number' >&2; exit 1 ;;
      esac
      if [ "$count" -lt 1 ]; then
        echo 'slot count must be at least 1' >&2
        exit 1
      fi
      units=()
      n=1
      while [ "$n" -le "$count" ]; do
        units+=("github-runner-slot-$n.service")
        n=$((n + 1))
      done
      systemctl start "''${units[@]}"
    '';
  };
  # GitHub App key and cache signing material stay on runner hosts only.
  sops.secrets = lib.mkIf (settings.secretsFile != null) ({
    github-app-key = { mode = "0400"; };
  } // lib.optionalAttrs settings.cache.remote.enable {
    cache-credentials = { mode = "0400"; };
    cache-signing-key = { mode = "0400"; };
  });
}
