{ lib, pkgs, settings, ... }: {
  imports = [
    (./disks + "/${settings.role}.nix")
    ./sync.nix
    ./revision.nix
  ];
  system.stateVersion = "26.05";
  boot.loader.systemd-boot.enable = true;
  boot.loader.systemd-boot.configurationLimit = settings.bootGenerationLimit;
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
  systemd.settings.Manager = { RuntimeWatchdogSec = "30s"; RebootWatchdogSec = "5min"; };
  boot.kernel.sysctl."kernel.panic" = 10;
  boot.kernel.sysctl."kernel.panic_on_oops" = 1;
  systemd.tmpfiles.rules = [
    "d /nix/fleet-state 0700 root root -"
    "d /nix/fleet-state/ssh 0700 root root -"
    "d /nix/fleet-state/secrets 0700 root root -"
  ];
  # Age key path and sops file only. Role modules declare their own secrets.
  # A CI runner and a web server must not be given the same key or file.
  sops = lib.mkIf (settings.secretsFile != null) {
    defaultSopsFile = settings.secretsFile;
    age = { keyFile = "/nix/fleet-state/secrets/age.key"; generateKey = false; sshKeyPaths = [ ]; };
    gnupg.sshKeyPaths = [ ];
  };
}
