{ lib, pkgs, settings, ... }: {
  imports = [
    ./disks/internal.nix
    ./hardware/generic.nix
    ./capabilities/high-mem.nix
    ./identity.nix
    ./sync.nix
    ./revision.nix
    ./drift.nix
  ];
  # The module system ignores `revision ? null` and throws if the argument is
  # absent. Tests omit it. The flake passes the real commit via specialArgs,
  # which wins over this default.
  _module.args.revision = lib.mkDefault "unknown";
  system.stateVersion = "26.05";
  boot.loader.timeout = 5;
  boot.loader.systemd-boot.enable = true;
  boot.loader.systemd-boot.configurationLimit = settings.bootGenerationLimit;
  boot.loader.efi.canTouchEfiVariables = true;
  # The role name on the ESP. The netboot iPXE script reads it by volume label.
  # ci-gpu is role ci. This is not a per-machine file.
  boot.loader.systemd-boot.extraFiles."fleet-role.ipxe" = pkgs.writeText "fleet-role.ipxe" ''
    #!ipxe
    set fleet_role ${settings.role}
  '';
  # Newest entry gets tries-left. See scripts/boot-count.sh. This pin has no
  # boot-counting module option. graceful is not fallback.
  boot.loader.systemd-boot.extraInstallCommands = ''
    export PATH=${lib.makeBinPath [ pkgs.coreutils pkgs.findutils pkgs.gawk ]}:$PATH
    export FLEET_ESP=/boot
    export FLEET_BOOT_TRIES=${toString settings.bootTries}
    ${pkgs.bash}/bin/bash ${../scripts/boot-count.sh}
  '';
  # No static hostname. hostnamed prefers /etc/hostname, and that file is
  # read-only on NixOS, so a transient name would never be applied.
  # Wired DHCP is matched by device type in the generic hardware profile.
  networking.hostName = "";
  networking.firewall = { enable = true; allowedTCPPorts = [ 22 ]; };
  time.timeZone = "UTC";
  services.openssh = {
    enable = true;
    settings = { PasswordAuthentication = false; KbdInteractiveAuthentication = false;
      PermitRootLogin = "prohibit-password"; };
    hostKeys = [ { path = "/nix/fleet-state/ssh/ssh_host_ed25519_key"; type = "ed25519"; } ];
  };
  users.mutableUsers = false;
  # An empty sshKeys list is valid. Remote login stays closed until a commit
  # adds keys. The installer console does not need them.
  users.allowNoPasswordLogin = settings.sshKeys == [ ];
  users.users.root = { hashedPassword = "!"; openssh.authorizedKeys.keys = settings.sshKeys; };
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    auto-optimise-store = false;
    min-free = 2 * 1024 * 1024 * 1024;
    max-free = 8 * 1024 * 1024 * 1024;
  } // lib.optionalAttrs (
    settings.binaryCache.url != null
    && settings.binaryCache.publicKey != null
    && !(lib.hasInfix "TODO" settings.binaryCache.url)
    && !(lib.hasInfix "TODO" settings.binaryCache.publicKey)
  ) {
    extra-substituters = [ settings.binaryCache.url ];
    extra-trusted-public-keys = [ settings.binaryCache.publicKey ];
  };
  nix.gc = { automatic = true; dates = "weekly"; options = "--delete-older-than 14d"; };
  nix.optimise = { automatic = true; dates = [ "03:00" ]; };
  environment.systemPackages = with pkgs; [ git pciutils ethtool nvme-cli jq ];
  # Hardware watchdog: a hung userspace stops petting /dev/watchdog and the
  # firmware reboots. RebootWatchdogSec covers a reboot that never finishes.
  # softdog is not a substitute. Boot counting covers a generation that never
  # reaches userspace.
  systemd.settings.Manager = { RuntimeWatchdogSec = "30s"; RebootWatchdogSec = "5min"; };
  # The root is tmpfs, so the journal lives in RAM. Cap it. TODO: ship it
  # off-node once monitoring.pushUrl has a real collector. Do not invent one.
  services.journald.storage = "volatile";
  services.journald.extraConfig = ''
    RuntimeMaxUse=256M
    MaxRetentionSec=2week
  '';
  boot.kernel.sysctl."kernel.panic" = 10;
  boot.kernel.sysctl."kernel.panic_on_oops" = 1;
  systemd.tmpfiles.rules = [
    "d /nix/fleet-state 0700 root root -"
    "d /nix/fleet-state/ssh 0700 root root -"
    "d /nix/fleet-state/secrets 0700 root root -"
    "d /run/fleet 0755 root root -"
  ];
  # Local signal only. A failed unit is the alert. TODO: nothing scrapes
  # 127.0.0.1:9101, and monitoring.pushUrl is not read.
  # Public material only. The private age key stays in fleet-state.
  systemd.services.fleet-console-info = {
    description = "Print the age public key and host fingerprint on the console";
    wantedBy = [ "multi-user.target" ];
    after = [ "systemd-user-sessions.service" ];
    serviceConfig.Type = "oneshot";
    script = ''
      exec > /dev/console
      echo "fleet revision: $(cat /etc/fleet/revision 2>/dev/null || echo unknown)"
      if [ -s /nix/fleet-state/secrets/age.pub ]; then
        echo "age public key:"
        cat /nix/fleet-state/secrets/age.pub
      fi
      if [ -s /nix/fleet-state/ssh/ssh_host_ed25519_key.pub ]; then
        ${pkgs.openssh}/bin/ssh-keygen -lf /nix/fleet-state/ssh/ssh_host_ed25519_key.pub || true
      fi
      exit 0
    '';
  };
  systemd.services.fleet-disk = {
    description = "Fail when /nix or /boot is too full";
    serviceConfig.Type = "oneshot";
    path = [ pkgs.coreutils pkgs.gawk ];
    script = ''
      set -eu
      install -d -m 0755 /run/fleet
      : > /run/fleet/disk-alert
      fail=0
      for mount in /nix /boot; do
        if [ ! -d "$mount" ]; then
          continue
        fi
        used=$(df -P "$mount" | awk 'NR==2 { gsub("%","",$5); print $5 }')
        printf '%s %s\n' "$mount" "$used" >> /run/fleet/disk-alert
        if [ "$used" -ge ${toString settings.disk.alertPercent} ]; then
          echo "fleet-disk: $mount is ''${used}% full" >&2
          fail=1
        fi
      done
      exit "$fail"
    '';
  };
  systemd.timers.fleet-disk = {
    wantedBy = [ "timers.target" ];
    timerConfig = { OnBootSec = "5min"; OnUnitActiveSec = "15min"; };
  };
  systemd.services.fleet-age-rotate = lib.mkIf (settings.rotateAgeKey or false) {
    description = "Install a rotated age key from sops";
    wantedBy = [ "multi-user.target" ];
    after = [ "sops-install-secrets.service" ];
    wants = [ "sops-install-secrets.service" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    script = ''
      set -eu
      next=/run/secrets/age-key-next
      dest=/nix/fleet-state/secrets/age.key
      [ -s "$next" ]
      if [ -f "$dest" ] && cmp -s "$next" "$dest"; then
        exit 0
      fi
      install -d -m 0700 /nix/fleet-state/secrets
      install -m 0600 "$next" "$dest.next"
      mv "$dest.next" "$dest"
    '';
  };
  # Age key path and sops file only. Role modules declare their own secrets.
  # A CI runner and a web server must not be given the same key or file.
  sops = lib.mkIf (settings.secretsFile != null) {
    defaultSopsFile = settings.secretsFile;
    age = { keyFile = "/nix/fleet-state/secrets/age.key"; generateKey = false; sshKeyPaths = [ ]; };
    gnupg.sshKeyPaths = [ ];
    secrets = lib.mkIf (settings.rotateAgeKey or false) {
      age-key-next = { mode = "0400"; restartUnits = [ "fleet-age-rotate.service" ]; };
    };
  };
  assertions = [
    {
      assertion = settings.bootTries >= 1;
      message = "bootTries is the tries-left count on the newest systemd-boot entry.";
    }
    {
      assertion = settings.disk.alertPercent >= 50 && settings.disk.alertPercent <= 99;
      message = "disk.alertPercent is the /nix and /boot fullness threshold.";
    }
    {
      assertion = lib.all (id: lib.match "[0-9a-f][0-9a-f][0-9a-f][0-9a-f]" id != null) settings.reinstall.nodes;
      message = "reinstall.nodes entries are 4 lowercase hex digits, the stable id.";
    }
    {
      assertion = lib.all (role: builtins.elem role [ "ci" "web" "cache" "netboot" ]) settings.reinstall.roles;
      message = "reinstall.roles names a role. ci-gpu is role ci.";
    }
    {
      assertion = (settings.rotateAgeKey or false) -> settings.secretsFile != null;
      message = "rotateAgeKey needs this role's secretsFile, with secret age-key-next.";
    }
  ];
}
