# Steps that stay manual

After a node has booted into its role, the only manual tasks are physical: replace hardware, clean it, and the one-time BIOS setup below. A step that seems to need a person at a running node is a bug. Fix it in code. SSH is read-only emergency access. No changes are ever made over SSH.

These bring-up steps happen once, before the node is polling `main`. They are not how a running node is changed.

1. Rack the machine and cable power and a wired Ethernet port. Do not record a name or a MAC into git. Another machine of the same role is another install, not a host file.
2. Firmware, once: disable Secure Boot. lanzaboote is not wired up; it is a later option if Secure Boot has to stay on. Enable UEFI USB boot and network boot. Set the boot order to network, then the internal disk. The netboot server then chooses the disk or the installer. Enable power-on after AC loss when the firmware offers it. Do not change this order per machine later.
3. On any computer with `gh`, run `just fetch-iso` in this package and flash `fleet-installer.iso` with `just flash-usb`. Boot that stick. The console logs in and prints `fleet-install ci` (or `web`, `cache`, `netboot`). Type the disk path it prints. The machine generates the age key and installs the system that CI already built. Nix on that computer is not required.
4. Optional: plug in a filesystem labeled `FLEET-KEY` before `fleet-install`. An existing `<role>.age` on it is the key for this role. An empty volume receives the new key so the next node of the role can decrypt the same file. CI and web must not share a key.
5. Remove the USB and reboot. The console prints the age public key and `ssh-keygen -lf` of `/nix/fleet-state/ssh/ssh_host_ed25519_key.pub`. Encrypt secrets to that public key from any computer. `sshKeys` in `settings/shared.nix` stays empty until remote read-only access is wanted.
6. Apply the reviewed OpenTofu plan that adds the merge queue and the `Fleet` required check to `main`. Until that plan is applied, GitHub is still on the previous ruleset. Do not push `main` directly.

The repository URL, attic host, attic public key, attic token, and the git read credential are still `TODO` in git. Fill them in a commit. Do not invent a cache hostname.
