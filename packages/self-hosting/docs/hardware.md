# MS-A2 hardware evidence

MINISFORUM advertises the Ryzen 9 9955HX with 16 cores/32 threads, Realtek RTL8125 and Intel I226-V 2.5-GbE, dual Intel X710 10-GbE SFP+, and up to 96-GiB DDR5. These are product specifications, not a claim that the delivered unit has been tested. Verify its actual PCI IDs, NIC revision, firmware, RAM, disk slot, thermals and stable `/dev/disk/by-path` before installing.

The pinned Linux 6.12 family contains RTL8125 support in `r8169`, I226-V (`0x125c`) in `igc`, and X710 support in `i40e`. The profile loads these in-tree drivers and AMD KVM, enables AMD microcode and redistributable firmware, and adds NVMe/USB storage initrd modules. It does not install an out-of-tree Realtek driver or assume freeze reports establish a kernel workaround. BIOS revisions and board watchdog exposure remain physical qualification tasks. No watchdog driver is forced without proof; systemd requests hardware watchdog use if a supported device exists.

Sources inspected:

- [MINISFORUM MS-A2 product specifications](https://store.minisforum.com/en-os/products/minisforum-ms-a2-workstation).
- [Linux v6.12 r8169 PCI IDs and RTL8125 firmware](https://github.com/torvalds/linux/blob/v6.12/drivers/net/ethernet/realtek/r8169_main.c).
- [Linux v6.12 I226 IDs](https://github.com/torvalds/linux/blob/v6.12/drivers/net/ethernet/intel/igc/igc_hw.h).
- [Linux v6.12 i40e device IDs](https://github.com/torvalds/linux/blob/v6.12/drivers/net/ethernet/intel/i40e/i40e_devids.h).
- [NixOS runner options at the locked nixpkgs revision](https://github.com/NixOS/nixpkgs/blob/7c8764b7c7b09b34f632464276218ef9090eaa11/nixos/modules/services/continuous-integration/github-runner/options.nix).
- [NixOS runner service lifecycle at the locked revision](https://github.com/NixOS/nixpkgs/blob/7c8764b7c7b09b34f632464276218ef9090eaa11/nixos/modules/services/continuous-integration/github-runner/service.nix).
- [Runner environment-name support](https://github.com/actions/runner/blob/main/src/Runner.Listener/CommandSettings.cs) and [shutdown cancellation semantics](https://github.com/actions/runner/blob/main/src/Runner.Listener/JobDispatcher.cs).

Verify with `lspci -nnk`, `ethtool -i NIC`, `uname -r`, `journalctl -k`, and `/sys/class/watchdog/*/identity`. Test cold boots and sustained load with your projects before enabling unattended updates. No hardware burn-in or hard-hang recovery test was performed here.
