{ config, lib, pkgs, settings, ... }: let
  cap = settings.capacity;
  token = value: let text = toString value; in
    assert builtins.match "[A-Za-z0-9._-]+" text != null; text;
in {
  assertions = [
    {
      assertion = config.networking.hostName == "";
      message = "Hostnames are assigned at boot. Leave networking.hostName empty.";
    }
    {
      assertion = builtins.elem settings.role [ "ci" "web" "cache" "netboot" ];
      message = "settings.role must be a role, not a machine.";
    }
    {
      assertion = builtins.elem settings.track [ "deploy" "canary" ];
      message = "settings.track must be deploy or canary. Canary is not a MAC list.";
    }
    {
      assertion = lib.hasPrefix settings.role settings.flakeAttr;
      message = "settings.flakeAttr must be this role or a capability/track variant of it.";
    }
    {
      assertion = cap.slotMax >= 1 && cap.slotMax <= 64
        && cap.perRunnerCores >= 1 && cap.perRunnerGiB >= 1
        && cap.reserveGiB >= 0 && cap.highMemGiB >= 1;
      message = "capacity constants must stay in range. slotMax is 1..64.";
    }
  ];
  environment.etc."fleet/node.conf".text = ''
    role=${token settings.role}
    flake_attr=${token settings.flakeAttr}
    track=${token settings.track}
    reserve_gib=${token cap.reserveGiB}
    per_runner_gib=${token cap.perRunnerGiB}
    per_runner_cores=${token cap.perRunnerCores}
    slot_max=${token cap.slotMax}
    high_mem_gib=${token cap.highMemGiB}
  '';
  # Transient hostname only. /etc/hostname stays absent. hostnamectl needs
  # dbus, so this is not before sysinit. Journald may already be running.
  # SSH, metrics, and runner registration wait for this unit.
  systemd.services.node-identity = {
    description = "Name this machine from its role, capabilities, and stable id";
    wantedBy = [ "multi-user.target" ];
    after = [ "systemd-udevd.service" "dbus.service" ];
    requires = [ "dbus.service" ];
    before = [ "sshd.service" "fleet-revision.service" "fleet-capacity.service" ];
    path = [ pkgs.python3 pkgs.coreutils pkgs.systemd ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    script = ''
      python3 ${../scripts/cattle.py} identity
    '';
  };
}
