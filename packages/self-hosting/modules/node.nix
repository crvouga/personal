{ config, lib, pkgs, settings, ... }: {
  _module.args.registrationProvider = lib.mkDefault null;
  _module.args.drainProvider = lib.mkDefault null;
  system.stateVersion = "26.05";
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  # No static hostname. hostnamed prefers /etc/hostname, and that file is
  # read-only on NixOS, so a transient name would never be applied.
  networking.hostName = "";
  networking.dhcpcd.setHostname = false;
  networking.useDHCP = true;
  networking.firewall = { enable = true; allowedTCPPorts = [ 22 ]; };
  time.timeZone = "UTC";
  services.openssh = {
    enable = true;
    settings = { PasswordAuthentication = false; KbdInteractiveAuthentication = false;
      PermitRootLogin = "prohibit-password"; };
    hostKeys = [ { path = "/nix/fleet-state/ssh/ssh_host_ed25519_key"; type = "ed25519"; } ];
  };
  users.mutableUsers = false;
  # Keep the unconfigured template evaluable; installer refuses empty SSH keys.
  users.allowNoPasswordLogin = settings.sshKeys == [ ];
  users.users.root = { hashedPassword = "!"; openssh.authorizedKeys.keys = settings.sshKeys; };
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    auto-optimise-store = false;
    min-free = 2 * 1024 * 1024 * 1024;
    max-free = 8 * 1024 * 1024 * 1024;
  };
  nix.gc = { automatic = true; dates = "weekly"; options = "--delete-older-than 14d"; };
  nix.optimise = { automatic = true; dates = [ "03:00" ]; };
  programs.nix-ld.enable = true;
  environment.systemPackages = with pkgs; [ git pciutils ethtool nvme-cli jq ];
  virtualisation.podman = lib.mkIf settings.containers { enable = true; dockerCompat = true; };
  systemd.settings.Manager = { RuntimeWatchdogSec = "30s"; RebootWatchdogSec = "5min"; };
  boot.kernel.sysctl."kernel.panic" = 10;
  boot.kernel.sysctl."kernel.panic_on_oops" = 1;
  systemd.tmpfiles.rules = [
    "d /nix/fleet-state 0700 root root -"
    "d /nix/fleet-state/ssh 0700 root root -"
    "d /nix/fleet-state/secrets 0700 root root -"
  ];
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
  sops = lib.mkIf (settings.secretsFile != null) {
    defaultSopsFile = settings.secretsFile;
    age = { keyFile = "/nix/fleet-state/secrets/age.key"; generateKey = false; sshKeyPaths = [ ]; };
    gnupg.sshKeyPaths = [ ];
    secrets = {
      github-app-key = { mode = "0400"; };
    } // lib.optionalAttrs settings.cache.remote.enable {
      cache-credentials = { mode = "0400"; };
      cache-signing-key = { mode = "0400"; };
    };
  };
}
