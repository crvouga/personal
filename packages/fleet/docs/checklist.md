# Steps that stay manual

After a node has booted into its role, the only manual tasks are physical: replace hardware, clean it, and the one-time BIOS setup below. A step that seems to need a person at a running node is a bug. Fix it in code. SSH is read-only emergency access. No changes are ever made over SSH.

These bring-up steps happen once, before the node is polling `main`. They are not how a running node is changed.

1. Rack the machine and cable power and a wired Ethernet port. Do not record a name or a MAC into git. Another machine of the same role is another bootstrap, not a host file.
2. Firmware, once: disable Secure Boot. lanzaboote is not wired up; it is a later option if Secure Boot has to stay on. Enable UEFI USB boot and network boot. Set the boot order to network, then the internal disk. The netboot server then chooses the disk or the installer. Enable power-on after AC loss when the firmware offers it. Do not change this order per machine later.
3. Do not put a disk path in git. Bootstrap asks the installer which internal disk it found (NVMe, then SATA) and requires you to type that path. USB sticks and mounted disks are skipped.
4. Create the role age key on the work computer and back it up outside the repo. The path is `$HOME/.config/fleet/keys/<role>.age`, or `$FLEET_KEY_DIR/<role>.age`. Run `age-keygen -o` that path. `ci.age`, `web.age`, `cache.age`, and `netboot.age` must be different keys. CI and web never share one. Do not commit the private key.
5. Put this computer's public SSH keys in `settings/shared.nix` `sshKeys`. The installer and every role use that list.
6. After bootstrap reboots, read the installed fingerprint on the console: `ssh-keygen -lf /nix/fleet-state/ssh/ssh_host_ed25519_key.pub`. Accept that key. The ISO key is a different, ephemeral key.
7. Apply the reviewed OpenTofu plan that adds the merge queue and the `Fleet` required check to `main`. Until that plan is applied, GitHub is still on the previous ruleset. Do not push `main` directly.

The repository URL, attic host, attic public key, attic token, and the git read credential are still `TODO` in git. Fill them in a commit. Do not invent a cache hostname.
