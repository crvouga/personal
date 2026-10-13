The shared installer is [modules/installer.nix](../modules/installer.nix) plus [modules/installer-iso.nix](../modules/installer-iso.nix). `just build-iso` builds `.#installer` as `fleet-installer.iso`.

The image enables SSH and DHCP and installs the admin public keys from [settings/installer.nix](../settings/installer.nix). It does not partition a disk, embed a role closure, or carry an age key. One USB boots every role. The netboot role serves this same installer only when `reinstall.nodes` or `reinstall.roles` flags the client. Otherwise the client boots its local disk.

Booting the ISO does not wipe a disk. `just bootstrap ROLE IP` does, after the machine is at the installer and the operator types the disk path `select-disk` printed. That command runs again inside the disko script on the target and refuses a different disk. The live image has no fleet hostname.
