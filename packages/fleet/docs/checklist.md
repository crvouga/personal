# Steps that stay manual

After a node has booted into its role, the only manual tasks are physical: replace hardware, clean it, and the one-time BIOS setup below. A step that seems to need a person at a running node is a bug. Fix it in code. SSH is read-only emergency access. No changes are ever made over SSH.

These bring-up steps happen once, before the node is polling `main`. They are not how a running node is changed.

1. Rack the machine and cable power and a wired Ethernet port. Do not record a name or a MAC into git. Another machine of the same role is another install, not a host file.
2. Firmware, once: disable Secure Boot. lanzaboote is not wired up; it is a later option if Secure Boot has to stay on. Enable UEFI USB boot and network boot. Set the boot order to network, then the internal disk. Enable power-on after AC loss when the firmware offers it. Do not change this order per machine later. A reinstall flag in git does not install a node: the netboot host does not serve an image that can finish an install.
3. On the machine itself, download one file and run it. Nix, a git checkout, `just`, and a second computer are not required.

   ```sh
   curl -fsSL -o fleet-node.sh https://github.com/crvouga/workspace/releases/download/fleet-installer/fleet-node.sh
   bash fleet-node.sh
   ```

   For no prompts at all: `bash fleet-node.sh ci --yes` (or `web`, `cache`, `netboot`, `devbox`). `--yes` skips only the typed confirmation; a USB, removable, hotplug, or ambiguous disk is still refused. Save the file first; piping it into `bash` is not supported. Otherwise type `ci`, `web`, `cache`, `netboot`, or `devbox` when asked. The program names that role and the internal disk. Nothing is erased until you type the line it shows. An empty answer, a wrong line, a timeout, or a USB, removable, hotplug, mounted, or ambiguous disk leaves every disk unchanged and prints one next step. Run the same command again after a failure or after a finished install. A finished install is not wiped a second time. The age private key is not printed. Do not add a host file, a MAC, a disk path, or a hostname.

   An agent can do this step: `Set this machine up as a fleet <role> node by following https://raw.githubusercontent.com/crvouga/workspace/main/packages/fleet/docs/agent-install.md`. `sudo bash fleet-node.sh doctor <role>` shows the disk and any blocker first and writes nothing.

4. Optional, for a role whose secrets are encrypted to a shared key: pass a single-use enrollment token instead of carrying a USB. `bash fleet-node.sh ci --yes --token-file token` (see the enrollment paragraph in [AGENTS.md](../AGENTS.md)). Or plug in a filesystem labeled `FLEET-KEY` before the install reboots. An existing `<role>.age` on it is the key for this role. An empty volume receives the new key so the next node of the role can decrypt the same file. CI and web must not share a key.
5. A machine with no operating system cannot download. On a computer that already has one, use the wizard or run `bash fleet-node.sh flash` and boot that USB disk from the firmware one-time menu. `flash` refuses an internal disk. Choose ci, web, cache, netboot or devbox and press Enter. The UEFI menu waits for your choice; every entry erases the internal disk. A devbox asks for an SSH public key before wiping.
6. If the firmware would boot the stick again, pull it when the console says the install finished. The lasting boot order stays network, then the internal disk. The console prints the age public key and `ssh-keygen -lf` of `/nix/fleet-state/ssh/ssh_host_ed25519_key.pub`. Encrypt secrets to that public key from any computer. `sshKeys` in `settings/shared.nix` stays empty until remote read-only access is wanted. The hostname is `<role>[-gpu][-highmem]-<4 hex>` from the hardware id.
7. Apply the reviewed OpenTofu plan that adds the merge queue and the `Fleet` required check to `main`. Until that plan is applied, GitHub is still on the previous ruleset. Do not push `main` directly.

The attic host, attic public key, attic token, and the git read credential are still `TODO` in git. Fill them in a commit. Do not invent a cache hostname.
