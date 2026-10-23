{ pkgs, lib, sopsModule, diskoModule, ... }: let
  settings = import ../devbox.nix;
  key = pkgs.runCommand "devbox-test-key" { nativeBuildInputs = [ pkgs.openssh ]; } ''
    mkdir -p "$out"
    ssh-keygen -q -t ed25519 -N "" -f "$out/id"
  '';
in pkgs.testers.runNixOSTest {
  name = "fleet-devbox";
  node.specialArgs = { settings = settings // { repo = settings.repo // { timer = false; }; fleetApi = { url = ""; }; }; };
  nodes.machine = {
    imports = [ sopsModule diskoModule ../hosts/devbox.nix ];
    disko.enableConfig = lib.mkForce false;
    boot.loader.systemd-boot.enable = lib.mkForce false;
    users.users.root.hashedPassword = lib.mkForce null;
    virtualisation = { memorySize = 2048; cores = 2; writableStore = true; };
    systemd.services.test-devbox-key = {
      wantedBy = [ "multi-user.target" ];
      before = [ "sshd.service" ];
      serviceConfig.Type = "oneshot";
      script = ''
        install -d -m 0700 /nix/fleet-state/devbox
        install -m 0600 ${key}/id.pub /nix/fleet-state/devbox/authorized_keys
        install -m 0600 ${key}/id /root/devbox-test-key
      '';
    };
  };
  testScript = ''
    # SSH must not read the test driver's command/completion stream.
    ssh = "ssh -n -T -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i /root/devbox-test-key dev@localhost"
    machine.start(allow_reboot=True)
    machine.wait_for_unit("multi-user.target")
    machine.wait_for_unit("sshd.service")
    machine.succeed("grep -qx role=devbox /etc/fleet/node.conf")
    machine.succeed("getent passwd dev | grep -F /nix/devbox")
    machine.succeed("test ! -L /run/fleet/devbox-authorized-keys; test $(stat -c %u /run/fleet/devbox-authorized-keys) = 0; test $(stat -c %a /run/fleet/devbox-authorized-keys) = 755")
    # SSH must not consume the test driver's command/completion stream on stdin.
    machine.succeed("ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i /root/devbox-test-key dev@localhost 'set -eu; test $HOME = /nix/devbox; echo persistent > ~/workspace-test; for devbox_tool in git bun node python3 gcc just tmux; do command -v $devbox_tool; done'", timeout=60)
    machine.fail("su - dev -c 'cat /nix/fleet-state/devbox/authorized_keys'")
    machine.fail("su - dev -c 'sudo -n true'")
    machine.fail("systemctl cat fleet-capacity.service")
    machine.succeed("test ! -e /run/fleet/slot-count; test ! -e /run/secrets/github-app-key")
    machine.succeed("sync")
    machine.reboot()
    machine.wait_for_unit("sshd.service")
    machine.succeed("ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i /root/devbox-test-key dev@localhost 'grep -qx persistent ~/workspace-test'", timeout=60)
  '';
}
