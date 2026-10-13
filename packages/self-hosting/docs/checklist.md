# Steps that stay manual

Git cannot do these. Everything else is `just bootstrap ROLE IP` or the pull timer.

1. Rack the machine and cable power and the NIC you intend to use. Record that NIC's MAC with the colons removed. A canary is that MAC, added later to `settings/shared.nix` `canaryMacs`.
2. Firmware: disable Secure Boot. lanzaboote is not wired up; it is a later option if Secure Boot has to stay on. Enable UEFI USB boot. Enable network boot when this box will install over PXE. Set the first boot to USB or network, and the later boot to the internal disk. Enable power-on after AC loss when the firmware offers it.
3. From a rescue shell that does not install anything, record the internal NVMe `by-path` (`ls -l /dev/disk/by-path`). Put that path in the role's settings file. Do not guess it, and do not use `/dev/nvme0n1`.
4. Create the role age key on the work computer and back it up outside the repo. The path is `$HOME/.config/self-hosting/keys/<role>.age`, or `$SELF_HOSTING_KEY_DIR/<role>.age`. Run `age-keygen -o` that path. `ci.age`, `web.age`, `cache.age`, and `netboot.age` must be different keys. CI and web never share one. Do not commit the private key.
5. Put this computer's public SSH keys in `settings/shared.nix` `sshKeys`. The installer and every role use that list.
6. After bootstrap reboots, read the installed fingerprint on the console: `ssh-keygen -lf /nix/fleet-state/ssh/ssh_host_ed25519_key.pub`. Accept that key. The ISO key is a different, ephemeral key.
7. In GitHub branch protection, allow only the GitHub Actions identity to push `deploy` and `canary`. Do not require a pull request for those two branches. People push `main` through the normal review path.

The repository URL, canary MACs, attic host, attic public key, attic token, and the git read credential are still `TODO` in git. Fill them in a commit. Do not invent a cache hostname.
