{ lib, pkgs, settings, ... }: {
  systemd.services.fleet-update = lib.mkIf settings.updates.enable {
    path = with pkgs; [ nix git coreutils systemd hostname ];
    serviceConfig.Type = "oneshot";
    script = ''
      set -euo pipefail
      # Deterministic per-host delay; root's machine-id is ephemeral.
      delay=$(printf '%s' "$(hostname)" | cksum | cut -d' ' -f1)
      sleep "$((delay % 7200))"
      # Build before draining: failures must not reduce fleet capacity.
      next=$(nix build --no-link --print-out-paths ${lib.escapeShellArg "${settings.updates.flake}#nixosConfigurations.${settings.profile}.config.system.build.toplevel"})
      /run/current-system/sw/bin/fleet-drain ${toString settings.updates.drainTimeoutSeconds}
      nix-env -p /nix/var/nix/profiles/system --set "$next"
      # Activate on next boot; this avoids restarting listeners during a kernel change.
      "$next/bin/switch-to-configuration" boot
      systemctl reboot
    '';
  };
  systemd.timers.fleet-update = lib.mkIf settings.updates.enable {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = settings.updates.calendar;
      Persistent = true;
    };
  };
}
