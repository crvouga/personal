The shared installer is [modules/installer.nix](../modules/installer.nix) plus [modules/installer-iso.nix](../modules/installer-iso.nix). `just build-iso` builds `.#installer` as `self-hosting-installer.iso`.

The image enables SSH and DHCP and installs the admin public keys from [settings/installer.nix](../settings/installer.nix). It does not partition a disk, embed a role closure, or carry an age key. One USB boots every role. The netboot role serves the same installer module over PXE.

Booting the ISO does not wipe a disk. `just bootstrap ROLE IP` does, after the machine is at the installer and the operator types the disk path. The disk guard in that command runs on the target, inside the guarded disko script, and rejects anything that is not the configured internal disk.
