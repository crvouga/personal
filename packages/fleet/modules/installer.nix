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
  # age stays on the system path. The console user is nixos, and sudo's
  # secure_path drops the fleet-install wrapper's PATH. age-keygen has to
  # survive that. select-disk and nixos-install are already there.
  environment.systemPackages = [
    pkgs.age
    (pkgs.writeShellScriptBin "select-disk" ''
      export PATH=${lib.makeBinPath [ pkgs.python3 pkgs.util-linux ]}:$PATH
      exec ${pkgs.python3}/bin/python3 ${../scripts/cattle.py} select-disk
    '')
    (pkgs.writeShellScriptBin "fleet-install" ''
      export PATH=${lib.makeBinPath [
        pkgs.coreutils pkgs.bash pkgs.age pkgs.openssh pkgs.python3
        pkgs.util-linux pkgs.gawk pkgs.sudo pkgs.diffutils pkgs.curl
      ]}:$PATH
      exec ${pkgs.bash}/bin/bash ${../scripts/fleet-install.sh} "$@"
    '')
  ];
  users.motd = ''
    fleet installer. The boot menu chooses ci, web, cache, or netboot.
    Choose a role deliberately; every entry erases the internal disk.
    A failed install can be retried with: fleet-install ci
  '';
  systemd.services.fleet-auto-install = {
    description = "Wipe the internal disk and install the role from the boot menu";
    wantedBy = [ "multi-user.target" ];
    before = [ "getty@tty1.service" ];
    after = [ "systemd-udev-settle.service" "local-fs.target" ];
    unitConfig.ConditionPathExists = "/iso/fleet-install-manifest";
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      StandardOutput = "journal+console";
      StandardError = "journal+console";
    };
    # A service path replaces the default and hides select-disk and
    # nixos-install. Keep the live system profile, then the tools this unit calls.
    script = ''
      export PATH="/run/current-system/sw/bin:${lib.makeBinPath [
        pkgs.bash
        pkgs.coreutils
        pkgs.gawk
        pkgs.util-linux
        pkgs.systemd
        pkgs.age
        pkgs.diffutils
      ]}"
      exec ${pkgs.bash}/bin/bash ${../scripts/fleet-auto.sh}
    '';
  };
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
  # The minimal CD creates a nixos user and sets a password. Lock it. The
  # console is autologin. SSH still requires a key from settings.sshKeys.
  users.users.nixos = {
    hashedPassword = lib.mkForce "!";
    initialPassword = lib.mkForce null;
    initialHashedPassword = lib.mkForce null;
  };
  boot.zfs.forceImportRoot = false;
}
