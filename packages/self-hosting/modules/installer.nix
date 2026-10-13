{ lib, settings, ... }: {
  # Live image only: SSH, DHCP, and the admin keys from settings/installer.nix.
  # It does not partition a disk or install a role. Bootstrap does that.
  networking.hostName = "installer";
  networking.useDHCP = lib.mkDefault true;
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = lib.mkForce false;
      KbdInteractiveAuthentication = lib.mkForce false;
      PermitRootLogin = lib.mkForce "prohibit-password";
    };
  };
  services.getty.autologinUser = lib.mkForce null;
  users.allowNoPasswordLogin = settings.sshKeys == [ ];
  users.mutableUsers = false;
  users.users.root = {
    hashedPassword = lib.mkForce "!";
    initialPassword = lib.mkForce null;
    initialHashedPassword = lib.mkForce null;
    openssh.authorizedKeys.keys = settings.sshKeys;
  };
  # The minimal CD creates a nixos user and sets a password. Lock it, and clear
  # the password options so they are not set twice. Login is the admin key only.
  users.users.nixos = {
    hashedPassword = lib.mkForce "!";
    initialPassword = lib.mkForce null;
    initialHashedPassword = lib.mkForce null;
  };
  boot.zfs.forceImportRoot = false;
}
