# Fleet installer (the wizard)

Download it, open it, choose what to install and confirm the disk. Accept the
operating system's permission prompt and, for in-place installation, approve
the GitHub page that opens. Preparation, downloads, verification and installation
then run automatically. No separate doctor command or manual setup checklist
is required. Windows, macOS and ordinary Linux need no Python or Nix installation.
On an existing fleet node, run `fleet-installer`; on other NixOS machines, use
the native launcher below.

**Before confirming an internal disk:** back up the files you want to keep to
another device, save any BitLocker recovery key there, and connect power and
a working Wi-Fi or Ethernet network. Installation erases the whole disk. A USB operation erases only
the USB disk you review; booting it on a target later erases that target's disk.

## Wi-Fi installation

Wi-Fi works through the download, reboot into the live installer, and the
installed node. The launcher carries the currently connected personal Wi-Fi
profile from Windows or NetworkManager on Linux. A macOS USB creator can read
its saved network from the system Keychain when macOS permits access. If the
OS cannot release a reusable password, expand **Use a different Wi-Fi network**
and enter the network once. This also selects a different target network, a
hidden SSID, or WPA3 Personal. The default remains automatic detection.

The privileged helper reads the saved password; it is never returned by the
plan API, logged, put in shell arguments, or added to a kernel command line or
the Nix store. In-place conversion uses a private supplemental initramfs. USB
creation writes a checksummed, read-back-verified Wi-Fi handoff outside the ISO
filesystem. **Keep a prepared USB private: it contains a reusable network
password.** Creating a new USB without Wi-Fi settings clears an old handoff.

The live installer connects and checks DNS/TLS before consuming an enrollment
token or erasing the internal disk. A temporary outage makes it wait and retry
automatically. Disk/install failures are not retried automatically. The profile
is stored root-only under `/nix/fleet-state/network`, restored before
NetworkManager starts on every boot, and reconnects automatically when the
access point returns. It is not bound to an interface name or MAC address.
Wired networking remains available as a fallback.

Supported automatic networks use DHCP and open, WPA/WPA2 Personal, or WPA3
Personal authentication. Enterprise/802.1X certificates, WEP, captive portals,
and adapters without a driver/firmware in the pinned Linux system are not
silently guessed or treated as working. A Wi-Fi-only install waits before
wiping if it cannot connect. A Wi-Fi network/password cannot be invented when
neither the source OS nor the person supplies it. PXE firmware/network boot
remains a wired facility; USB and in-place installation support Wi-Fi.

Software tests cover transfer, credential privacy, corruption, readiness and
reboot preparation. The `wifi-vm` check uses simulated radios with real
NetworkManager, hostapd and DHCP/DNS to exercise connection, AP loss and reboot.
This does not certify a particular physical Wi-Fi adapter or Windows firmware.

## What happens automatically

| Platform                           | The installer handles                                                                                                            | What still needs a person                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Windows x64                        | Hardware/storage checks, one free-space consolidation attempt if needed, verified image, boot setup, restart, NixOS installation | OS permission, GitHub approval, disk confirmation; Secure Boot off if enabled                      |
| Linux x64                          | Checks, missing `kexec-tools` installation through apt/dnf/zypper/pacman, verified image, kexec, NixOS installation              | OS permission, GitHub approval, disk confirmation; unsupported filesystems or firmware require USB |
| NixOS x64                          | Native dependencies are bundled; checks, verified image, kexec and installation                                                  | OS permission, GitHub approval and disk confirmation                                               |
| macOS, Linux ARM64 and NixOS ARM64 | USB discovery, image download, unmounting, writing and read-back verification                                                    | Disk confirmation and OS permission; move the USB to a supported x64 target and boot it there      |

All platforms retry transient network failures up to three attempts. Reloading
the page reconnects to the existing job. It does not start another write or
reuse an erase confirmation. The only USB is preselected, but its identity must
still be reviewed and confirmed. Failed hard checks, checksum mismatches and
failed writes are never bypassed or retried as destructive operations.

Firmware changes, connecting cables, choosing a backup destination, unsigned-app
approval and booting another computer from USB cannot be performed silently by
this installer. It shows only the relevant problems. The current image supports
x86-64 UEFI targets; Apple silicon and ARM boards make media for other machines.
USB media still asks for its role at boot and does not carry enrollment secrets:
for a CI target, supply the canonical CI key on a `FLEET-KEY` volume as described
in the [checklist](checklist.md). A plain USB by itself cannot enroll a working
CI runner. Prefer enrolled in-place conversion on supported Windows/Linux PCs.

## 1. Download

Open the [`fleet-installer` release](https://github.com/crvouga/workspace/releases/tag/fleet-installer) and take the file for the computer you are sitting at:

| Computer                 | File                                 |
| ------------------------ | ------------------------------------ |
| Windows (Intel/AMD)      | `fleet-installer-windows-x64.exe`    |
| Mac with Apple silicon   | `fleet-installer-macos-arm64.zip`    |
| Mac with an Intel chip   | `fleet-installer-macos-x64.zip`      |
| Linux (Intel/AMD)        | `fleet-installer-linux-x64.tar.gz`   |
| Linux (ARM, e.g. a Pi 5) | `fleet-installer-linux-arm64.tar.gz` |
| NixOS (x86-64 or ARM64)  | Native Nix command below             |

The computer you run it on does not have to be the computer that becomes the node. To set up a new or blank machine, run the wizard on any other computer and make an install USB.

The wizard downloads the image as verified parts and assembles one ISO locally.
The parts keep the offline image within GitHub's release asset size limit. Do
not write a `.part-*` file to a USB disk; let the wizard finish the download and
verification first.

## 2. Open it

The builds are not signed, so the system warns once:

- **Windows:** SmartScreen says "Windows protected your PC". Choose **More info**, then **Run anyway**. A black window opens and stays open; it prints the address of the wizard and the path of the log. Leave it open.
- **macOS:** unzip, then open `fleet-installer`. If it is blocked, open **System Settings > Privacy & Security** and choose **Open Anyway**, then open it again.
- **Linux:** `tar xzf fleet-installer-linux-*.tar.gz && ./fleet-installer`.

A page opens in your browser. If it does not, copy the address the program printed (it starts with `http://127.0.0.1:`) into a browser on the same computer. The page only answers that computer.

## 3. Answer the questions

1. The wizard looks at the computer and says what it can do. If the installer has not been published yet, or there is no internet, it says so here and stops.
2. Choose one:
   - **Make an install USB stick for another computer.** Works from Windows, macOS, and Linux. Plug in a USB stick (at least 8 GB; everything on it is erased), choose it, review, confirm.
   - **Turn THIS computer into a node.** On x86-64 Windows (UEFI, GPT, Secure Boot off) and on x86-64 Linux with `kexec`. Choose the kind of node, review, confirm. A GitHub page opens: press **Submit new issue** as the repository owner (see Approval below). The computer then restarts into the installer, erases its disk (Windows included), installs, and restarts as the node. macOS cannot do this; the wizard tells you and offers the USB instead.
     For a **Remote devbox**, choose your SSH public `.pub` file in the wizard. Keep the matching private key on the computer you will connect from. A missing or malformed public key blocks installation.
3. **Review** names the exact disk and what will be erased, shows preparation the installer will perform, and surfaces only warnings and checks that need your attention. The full automatic checks are available under a disclosure. Nothing is changed until you tick the box and press **Erase and install**.
4. The operating system asks for permission (Windows: the shield prompt, macOS: your password, Linux: the polkit dialog). Accept it. Declining changes nothing.

## 4. After the USB is made

Plug the stick into the new computer and start it from the stick (usually F12, F11, Esc, or Option at power-on; turn Secure Boot off once in the firmware settings). Choose **ci**, **web**, **cache**, **netboot**, or **devbox** in the installer menu, then press Enter. The UEFI menu waits for your choice; every entry erases the internal disk. The installer erases the computer's internal disk, installs, and restarts. Remove the stick when it says so.

## Changing a node's kind

- On an existing fleet node, run `sudo fleet-node web` (or `ci`, `cache`, `netboot`, `devbox`). It checks first, names the disk, and reinstalls. A same-role invocation keeps a healthy existing installation; use `--reinstall` to deliberately replace it.
- On any other Linux computer, the wizard's **Turn THIS computer into a node** does the same thing.

## NixOS

Use the native Nix package rather than the ordinary Linux download. It includes
its own Python and disk/boot tools and works without `nix-ld`. Current fleet
images install both `fleet-installer` and `fleet-node` on every role.

For the browser wizard on this machine:

```sh
sudo nix --extra-experimental-features 'nix-command flakes' run 'github:crvouga/workspace/main?dir=packages/fleet#fleet-installer' -- --no-browser
```

Open the loopback address printed in the terminal in a browser on that same
machine. If it is headless, use the CLI below instead. Root access lets the
wizard stage the image on the node's persistent `/nix` filesystem. The erase
checkbox and disk confirmation still apply. In the wizard, choose the existing
role and select **Hard reinstall** to replace a node with the same role.

For a hard reinstall from a terminal, first preview the exact disk and checks:

```sh
sudo fleet-node ci --reinstall --plan
sudo fleet-node ci --reinstall
```

If the installed command predates this flag, run the latest native CLI:

```sh
sudo nix --extra-experimental-features 'nix-command flakes' run 'github:crvouga/workspace/main?dir=packages/fleet#fleet-node' -- ci --reinstall --plan
sudo nix --extra-experimental-features 'nix-command flakes' run 'github:crvouga/workspace/main?dir=packages/fleet#fleet-node' -- ci --reinstall
```

Replace `ci` with the intended role. The second command asks you to confirm the
role and exact internal disk before anything is prepared. A hard reinstall
wipes the OS and every file on that disk; it requests fresh GitHub enrollment
so the newly installed role can decrypt its shared secrets. Do not use
`--no-enroll` when those secrets are needed. Active CI jobs block the operation;
an idle runner is withdrawn and new job admission is closed before handoff.
If the handoff fails, the node remains withdrawn and the hard reinstall can be
retried. Changing roles also erases the disk.

NixOS ARM64 can make install USB media. Fleet nodes still require x86-64 UEFI;
the program refuses to convert an ARM64 machine in place.

## Connecting to a remote devbox

Connect as `dev`: `ssh dev@<address>`. The node console prints its hostname, network addresses and host-key fingerprint. Check that fingerprint before accepting the SSH connection. The home directory is `/nix/devbox`; it survives reboot and system updates. Git, Bun, Node, Python, a C/C++ toolchain, Just and tmux are installed. Use `nix develop` for project dependencies. The dev account has no sudo; fleet system configuration comes from Git. Reinstalling into another role erases project work: back it up before converting.

For a USB devbox install, choose **devbox** in the boot menu. The console asks you to paste the public key before touching the disk. Alternatively place the public key in `devbox.pub` on a separate filesystem labeled `FLEET-KEY` and plug it in before booting. The private SSH key never belongs on the installer.

## Approval

A node needs its kind's key to decrypt the secrets that kind shares. You do not paste anything: after you press **Erase and install**, the wizard opens a GitHub issue already filled in with the kind and a one-time public key. Press **Submit new issue** while signed in as the repository owner. A workflow answers on the issue with a single-use token that only this computer can open, and the wizard continues. Nothing is erased while it waits (up to 15 minutes), and Cancel stops the wait. If the workflow reports a problem, such as Vault having no key for that kind yet, the wizard shows it and still has erased nothing. Someone who already has a token from `just enroll <kind>` can paste it instead. A node made from a USB stick has no approval: it makes its own key, which no other node shares.

## Windows

The wizard handles partition preparation, image verification, boot setup and
restart. If a shrink check fails, it first attempts free-space consolidation
once, then repeats the check. If a later staging step fails, it attempts to undo
the partition and boot changes; an undo failure is reported with its log.
Secure Boot must be off, the disk must be GPT and the PC must use UEFI. It needs
the current image size plus 2 GiB of RAM. [windows.md](windows.md) has optional
boot details and recovery instructions; they are not prerequisite manual steps.
This conversion has not been qualified on real hardware; use a backed-up spare
for the first run.

## Supported hardware and operating systems

The five downloads are for the computer making the USB, not five node architectures. Nodes currently require x86-64, UEFI, supported Wi-Fi or Ethernet networking and one unambiguous internal disk; Apple silicon and ARM boards can make install media but cannot become fleet nodes. The ordinary Linux downloads require glibc; Alpine/musl and old Linux distributions are not supported. NixOS uses the native Nix package on x86-64 or ARM64; it does not need a foreign ELF loader. macOS installations use a USB and require a physical firmware boot. Windows converts itself but needs Secure Boot turned off once. The wizard cannot automate firmware settings, hardware replacement, or unsigned-app approval. No claim of universal hardware support is made.

An interrupted USB write leaves an incomplete stick. Keep it plugged in, restart the wizard and write the whole image again; it never reports that stick as ready before verification passes. A role reinstall erases the old OS and files.

## When something goes wrong

Every failure says what happened and what to do next, and names a log file. The wizard keeps its log in the `.fleet/logs` folder in your home directory, and the installed node keeps `/nix/fleet-state/logs/install.log`. Nothing is erased before the review page's confirmation, and a USB stick is only reported as ready after the wizard reads it back and proves it holds the verified installer.

| You see                                           | Do this                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| "The installer download cannot be reached"        | Check the internet connection. If it is fine, the installer has not been published yet. |
| A `FAIL` on the review page                       | Do what its line says, then press **Check again**.                                      |
| "does not match its checksum"                     | Run the wizard again. If it repeats, the release is broken; re-run the Fleet workflow.  |
| "does not hold the installer after writing"       | The USB stick or its port is faulty. Try another stick or port.                         |
| "The permission prompt was probably declined"     | Run the wizard again and accept the prompt.                                             |
| "Disks were plugged or unplugged since you chose" | Run the wizard again.                                                                   |
