{ lib, pkgs, settings, node, ... }: let
  target = node.config.system.build.toplevel;
  partition = node.config.system.build.diskoScript;
  guard = pkgs.writeScript "fleet-disk-guard" ''#!${pkgs.python3}/bin/python3
${builtins.readFile ../scripts/disk-guard.py}
'';
in {
  image.fileName = "ci-${settings.profile}-installer.iso";
  isoImage.storeContents = [ target partition ];
  isoImage.makeEfiBootable = true;
  isoImage.makeUsbBootable = true;
  networking.hostName = "ci-installer";
  boot.zfs.forceImportRoot = false;
  services.getty.autologinUser = lib.mkForce null;
  environment.systemPackages = [ pkgs.python3 pkgs.nvme-cli ];
  systemd.services.fleet-install = {
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" ];
    conflicts = [ "getty@tty1.service" ];
    path = with pkgs; [ coreutils util-linux nix nixos-install-tools systemd ];
    serviceConfig = {
      Type = "oneshot";
      StandardInput = "tty"; StandardOutput = "tty"; StandardError = "tty";
      TTYPath = "/dev/tty1"; TTYReset = true; TTYVHangup = true;
    };
    script = ''
      set -euo pipefail
      ${lib.optionalString (settings.sshKeys == [ ] || settings.secretsFile == null) ''
        echo 'Fleet settings incomplete: configure SSH keys and encrypted secrets before installation.'
        exit 1
      ''}
      echo 'WARNING: INTERNAL NVMe WILL BE ERASED. All Windows data will be lost.'
      echo 'Press any key in the next 10 seconds to ABORT.'
      for seconds in $(seq 10 -1 1); do
        printf '%s... ' "$seconds"
        if read -r -s -n 1 -t 1; then echo 'Installation aborted.'; exit 1; fi
      done
      echo
      ${guard} ${lib.escapeShellArg settings.disk}
      ${partition}
      nixos-install --root /mnt --system ${target} --no-root-passwd --no-channel-copy --option substituters ""
      sync
      echo 'Installation complete. Powering off; remove the USB before powering on.'
      systemctl poweroff
    '';
  };
}
