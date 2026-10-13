{ config, lib, pkgs, settings, ... }: {
  # Live image. The USB ISO carries the role closures. fleet-install on this
  # console partitions the disk and installs. SSH is optional emergency access.
  # No static hostname. The installed system names itself at boot.
  networking.hostName = lib.mkForce "";
  networking.useDHCP = lib.mkDefault true;
  assertions = [{
    assertion = config.networking.hostName == "";
    message = "The installer does not set a static hostname.";
  }];
  environment.systemPackages = [
    (pkgs.writeShellScriptBin "select-disk" ''
      export PATH=${lib.makeBinPath [ pkgs.python3 pkgs.util-linux ]}:$PATH
      exec ${pkgs.python3}/bin/python3 ${../scripts/cattle.py} select-disk
    '')
    (pkgs.writeShellScriptBin "fleet-install" ''
      export PATH=${lib.makeBinPath [
        pkgs.coreutils pkgs.bash pkgs.age pkgs.openssh pkgs.python3
        pkgs.util-linux pkgs.gawk pkgs.sudo
      ]}:$PATH
      exec ${pkgs.bash}/bin/bash ${../scripts/fleet-install.sh} "$@"
    '')
  ];
  users.motd = ''
    fleet installer. This live image has not touched the disk.
    Install on this machine: fleet-install ci
    Roles on this image: ci, web, cache, netboot.
  '';
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = lib.mkForce false;
      KbdInteractiveAuthentication = lib.mkForce false;
      PermitRootLogin = lib.mkForce "prohibit-password";
    };
  };
  # The person at the machine installs it. Root stays locked; nixos has
  # passwordless sudo only on this live image.
  services.getty.autologinUser = lib.mkForce "nixos";
  security.sudo.extraRules = [{
    users = [ "nixos" ];
    commands = [{ command = "ALL"; options = [ "NOPASSWD" "SETENV" ]; }];
  }];
  users.users.nixos.extraGroups = [ "wheel" ];
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
