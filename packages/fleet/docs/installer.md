# Fleet installer (the wizard)

Download it, open it, answer the questions. No terminal, no Python, no Nix.

## 1. Download

Open the [`fleet-installer` release](https://github.com/crvouga/workspace/releases/tag/fleet-installer) and take the file for the computer you are sitting at:

| Computer                 | File                                 |
| ------------------------ | ------------------------------------ |
| Windows (Intel/AMD)      | `fleet-installer-windows-x64.exe`    |
| Mac with Apple silicon   | `fleet-installer-macos-arm64.zip`    |
| Mac with an Intel chip   | `fleet-installer-macos-x64.zip`      |
| Linux (Intel/AMD)        | `fleet-installer-linux-x64.tar.gz`   |
| Linux (ARM, e.g. a Pi 5) | `fleet-installer-linux-arm64.tar.gz` |

The computer you run it on does not have to be the computer that becomes the node. To set up a new or blank machine, run the wizard on any other computer and make an install USB.

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
   - **Turn THIS computer into a node.** Only on x86-64 Linux with `kexec`. Choose the kind of node, optionally paste an enrollment token, review, confirm. The computer restarts into the installer, erases its disk, installs, and restarts as the node. Windows and macOS cannot do this; the wizard tells you and offers the USB instead.
     For a **Remote devbox**, choose your SSH public `.pub` file in the wizard. Keep the matching private key on the computer you will connect from. A missing or malformed public key blocks installation.
3. **Review** lists every check with `ok`, `WARN` or `FAIL` and what to do about a failure, then names the exact disk and what will be erased. Nothing is changed until you tick the box and press **Erase and install**.
4. The operating system asks for permission (Windows: the shield prompt, macOS: your password, Linux: the polkit dialog). Accept it. Declining changes nothing.

## 4. After the USB is made

Plug the stick into the new computer and start it from the stick (usually F12, F11, Esc, or Option at power-on; turn Secure Boot off once in the firmware settings). Choose **ci**, **web**, **cache**, **netboot**, or **devbox** in the installer menu, then press Enter. The UEFI menu waits for your choice; every entry erases the internal disk. The installer erases the computer's internal disk, installs, and restarts. Remove the stick when it says so.

## Changing a node's kind

- On an existing fleet node, run `fleet-node web` (or `ci`, `cache`, `netboot`, `devbox`). It checks first, names the disk, and reinstalls. The wizard binary does not run on NixOS.
- On any other Linux computer, the wizard's **Turn THIS computer into a node** does the same thing.

## Connecting to a remote devbox

Connect as `dev`: `ssh dev@<address>`. The node console prints its hostname, network addresses and host-key fingerprint. Check that fingerprint before accepting the SSH connection. The home directory is `/nix/devbox`; it survives reboot and system updates. Git, Bun, Node, Python, a C/C++ toolchain, Just and tmux are installed. Use `nix develop` for project dependencies. The dev account has no sudo; fleet system configuration comes from Git. Reinstalling into another role erases project work: back it up before converting.

For a USB devbox install, choose **devbox** in the boot menu. The console asks you to paste the public key before touching the disk. Alternatively place the public key in `devbox.pub` on a separate filesystem labeled `FLEET-KEY` and plug it in before booting. The private SSH key never belongs on the installer.

## Enrollment token

A token lets a new node decrypt the secrets its kind shares. Someone with Vault access runs `just enroll <kind>`, which prints a single-use token that is valid for an hour. Paste it into the wizard. A node made from a USB stick has no token: it makes its own key, which no other node shares.

## Supported hardware and operating systems

The five downloads are for the computer making the USB, not five node architectures. Nodes currently require x86-64, UEFI, wired networking and one unambiguous internal disk; Apple silicon and ARM boards can make install media but cannot become fleet nodes. Linux downloads require glibc; Alpine/musl and old Linux distributions are not supported. Windows and macOS installations use a USB and require a physical firmware boot. The wizard cannot automate firmware settings, hardware replacement, or unsigned-app approval. No claim of universal hardware support is made.

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
