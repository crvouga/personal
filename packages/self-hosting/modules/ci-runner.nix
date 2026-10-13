{ lib, pkgs, settings, ... }: {
  imports = [ ./runners.nix ./cache.nix ./update.nix ];
  _module.args.registrationProvider = lib.mkDefault null;
  _module.args.drainProvider = lib.mkDefault null;
  programs.nix-ld.enable = true;
  virtualisation.podman = lib.mkIf settings.containers { enable = true; dockerCompat = true; };
  # Identity is the lowest permanent physical NIC MAC, independent of link state.
  systemd.services.fleet-identity = {
    wantedBy = [ "multi-user.target" ];
    before = [ "sshd.service" "fleet-update.service" ];
    path = with pkgs; [ coreutils findutils gawk systemd ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    script = ''
      mac=$(for nic in /sys/class/net/*; do
        [ -e "$nic/device" ] || continue
        [ "$(cat "$nic/addr_assign_type")" = 0 ] || continue
        cat "$nic/address"
      done | sort | head -n1 | tr -d ':')
      [ -n "$mac" ] || { echo 'No permanent physical NIC MAC'; exit 1; }
      hostnamectl --transient --no-ask-password set-hostname "ci-$mac"
      install -d -m 0755 /run/fleet
      printf 'ACTIONS_RUNNER_INPUT_NAME=ci-%s\n' "$mac" > /run/fleet/identity
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
