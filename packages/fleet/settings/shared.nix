# Values shared by every physical role. Not a per-machine file.
# Private keys, tokens, and age keys do not belong here.
{
  # TODO: this work computer's public SSH keys. The installer ISO and every
  # installed role use this same list. One USB then logs into any box.
  sshKeys = [ ];

  # systemd-boot entries kept on the EFI partition. Older generations stay
  # bootable until this limit or the weekly garbage collection removes them.
  bootGenerationLimit = 8;

  repo = {
    # TODO: real repository URL. Do not guess the owner. Every role polls main
    # over HTTPS. There is no deploy branch and no canary branch.
    url = "https://github.com/TODO/workspace.git";
    flakeDir = "packages/fleet";
    branch = "main";
    pollSeconds = 300;
    # none until a read-only deploy key or token is encrypted into this role's
    # sops file. Then set "ssh" or "token". CI and web still use different age keys.
    auth = "none";
    # Tests and broken configs can install the script without starting the timer.
    timer = true;
  };

  binaryCache = {
    # TODO: attic substituter URL (https://host/cache-name) and the Nix public key
    # (name:base64). Leave both null until they are real. Do not invent a host.
    url = null;
    publicKey = null;
  };

  # One formula for every CI machine, applied at boot by scripts/cattle.py:
  # min(slotMax, max(1, min(cores / perRunnerCores, (MemTotal MiB - reserveGiB*1024) / (perRunnerGiB*1024)))).
  # high-mem when MemTotal MiB is strictly above highMemGiB * 1024. 60 GiB
  # tags a 64 GiB box (MemTotal is a bit under 64) and not a 32 GiB box.
  capacity = {
    reserveGiB = 4;
    perRunnerGiB = 6;
    perRunnerCores = 2;
    slotMax = 8;
    highMemGiB = 60;
  };

  # How long origin/main may be ahead before fleet-drift fails.
  # The poll is repo.pollSeconds. A fresh merge stays inside this window.
  drift = {
    maxMinutes = 30;
  };

  reboot = {
    # Spread kernel reboots across this many seconds using the stable node id.
    delayMaxSeconds = 7200;
    # CI sets this to fleet-drain. Other roles leave it empty.
    drainCommand = "";
    drainTimeoutSeconds = 7200;
  };
}
