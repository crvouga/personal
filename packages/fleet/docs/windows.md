# Converting a Windows computer in place

Open the Windows installer, choose **Turn THIS computer into a node → CI**
(or another role), and confirm the disk it names. Accept the administrator
prompt and approve the GitHub page when it opens. The installer handles the
checks, download, free-space preparation, partitioning, boot setup and restart.
You do not need Git Bash, PowerShell commands, a separate doctor run or a plan.

Before confirming, back up the files you want to keep and save your BitLocker
recovery key on another device. Installation erases the entire internal disk.
Keep power connected. Saved personal Wi-Fi is carried into the installer and the installed node automatically; Ethernet also works. If a firmware setting needs changing,
the installer names it; Secure Boot must be disabled because the loader is
unsigned. The installer cannot make a backup without a destination or operate
your PC's firmware settings for you.

If Windows initially cannot shrink enough, the wizard consolidates free space
once and measures again. It does not delete your files or restore points, or
disable encryption, hibernation or the page file to make room. If that is not
enough, it stops before partitioning and offers the USB route. Transient network
failures retry automatically up to three attempts. Reloading the browser
reconnects to the current installation; it never repeats your erase approval.

**Validation limits.** A complete conversion and firmware handoff have not been verified on a real Windows computer. What has been checked without one: every PowerShell script is parsed by the real PowerShell parser and run against stand-in cmdlets; the UEFI boot option is compared byte for byte with a layout worked out by hand from the UEFI specification; every step and every undo is tested against a model of Windows. What has _not_ been checked: that Windows' own storage tools, `bcdedit`, `mountvol`, the firmware of your particular PC and the unsigned GRUB behave as expected. Try it on a spare machine first, with everything on it backed up.

<details>
<summary>Advanced reference: checks, boot internals and recovery</summary>

## Checks the installer performs

This is a troubleshooting reference, not a list of commands you must run.
The wizard performs software checks automatically. Backups, cabling and any
required firmware change still need the person at the computer.

- [ ] **Back up what you care about to another computer or drive.** The installer erases the whole disk (Windows, your files, the recovery partition, everything). Do not rely on this program to keep any of it.
- [ ] **Save the BitLocker recovery key** if BitLocker or "Device encryption" is on (Settings > Privacy & security > Device encryption, or <https://account.microsoft.com/devices/recoverykey>). Turning Secure Boot off, which this needs, can make Windows ask for the key, and so can a conversion that stops half way.
- [ ] **Plug in the power** (laptops), and keep it plugged in the whole time. A power cut while partitions are changing needs the recovery steps below.
- [ ] **Keep a working network.** Saved personal Wi-Fi is carried over automatically. If Windows cannot release its key, enter it once in the wizard’s Wi-Fi panel. The live installer checks connectivity before erasing anything; Ethernet is an optional fallback.
- [ ] **Unplug other drives and USB sticks.** The installer refuses to guess between two internal disks, and an external disk can look internal to Windows.
- [ ] **Turn Secure Boot off.** The installer's boot loader is not signed. Run `shutdown /r /fw` in an administrator window, open the firmware's Boot or Security page, set Secure Boot to Disabled, save, and start Windows again. (`msinfo32` shows "Secure Boot State: Off" when it worked.)
- [ ] **UEFI and GPT.** In `msinfo32`, "BIOS Mode" must say UEFI. In Disk Management, the disk's Properties > Volumes must say "GUID Partition Table (GPT)". A legacy-BIOS or MBR disk cannot convert; make an install USB instead (`fleet-node.sh flash`, or the wizard's USB option).

  The installer reads boot mode through Windows' [GetFirmwareType API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfirmwaretype). Older
  installers read the Windows PE `PEFirmwareType` registry value, which can be
  absent on installed Windows and falsely report legacy BIOS (issue #143).
  If that happens while `msinfo32` says UEFI, use the latest installer rather
  than converting the disk. Secure Boot must still be disabled. An unreadable
  boot mode stops installation and asks for diagnostics.

- [ ] **Enough RAM.** The installer image is copied whole into memory and the installer then needs room of its own: **the image size plus 2 GiB**. The check uses the current release size and names the exact figure. A USB install cannot help, because it boots the same image into RAM too.
- [ ] **Free space on C:** Windows has to be able to give up the image size plus 64 MiB from the end of `C:`, and the download sits on `C:` meanwhile, so the early check asks for both. If it says `C:` cannot shrink enough, see "C: will not shrink" below.
- [ ] **Run it as an administrator**: the wizard asks for permission by itself (UAC). For `fleet-node.sh`, open Git Bash with **Run as administrator**.
- [ ] **Optional CLI diagnostics**: `bash fleet-node.sh ci --plan` or `bash fleet-node.sh doctor ci`. The wizard already performs its own checks and disk review; neither command is required.

## What you will see

1. **Start it.** Either the wizard (`fleet-installer-windows-x64.exe`; choose _Turn THIS computer into a node_) or `bash fleet-node.sh ROLE` in an administrator Git Bash. The checks run and every problem is listed at once with what to do about it.
2. **Confirm the erase.** You type the line shown (CLI), or tick the box (wizard). The image is downloaded and verified before approval, so a slow Wi-Fi transfer cannot spend the approval token’s lifetime.
3. **Approve the node.** A GitHub page opens; the repository owner presses _Submit new issue_. The internal disk is still unchanged. Wi-Fi settings are carried to the live installer, which checks connectivity again before erasing it.
4. **Download and check the installer** (several GB, into `%LOCALAPPDATA%\fleet-installer` for the wizard or `~\.fleet` for the CLI). It is verified against its published checksum.
5. **Windows is prepared**, in this order (the messages appear on screen):
   1. _Making room_: `C:` is shrunk by the image size plus 64 MiB. Your files are not touched. This can take minutes.
   2. _Writing the installer into the new partition and reading it back_: a partition of type "Linux data" is created, the installer image is written into it, and every byte is read back and compared. If one differs, the program stops here and undoes the first two steps.
   3. _Placing the boot loader_: the EFI system partition is mounted on a spare drive letter and two things are put on it: GRUB (taken from the installer image itself) at `\EFI\fleet\grubx64.efi`, and a one-menu config at `\EFI\BOOT\grub.cfg`.
   4. _Telling the firmware to start the installer once_: two independent one-time boot entries are made, and at least one must verify:
      - `bcdedit`: a copy of the Windows boot manager entry named "Fleet installer" pointing at the GRUB file, added _last_ in the firmware boot order and set as the one-time `bootsequence`; the program reads `bootsequence` back.
      - A UEFI boot option (`Boot####`) written directly into the firmware variables, appended _last_ to `BootOrder`, and `BootNext` pointed at it; the program reads both back.
        Windows stays first in the normal boot order, so if the firmware ignores the one-time choice you simply land in Windows again.
   5. The computer is told to **restart in 15 seconds**. Save any open work now: Windows may show an "apps are preventing restart" screen; choose _Restart anyway_.
6. **The restart.** The screen shows a menu "Fleet installer: ERASES the internal disk and installs ROLE" for 3 seconds, then Linux boots. It copies the installer into RAM (a few minutes, text on screen), erases the disk, partitions it, installs NixOS, and restarts. Expect tens of minutes in total with no input. The machine comes back as `ROLE-xxxx` (the 4 hex digits come from the hardware).

If anything in step 5 fails, every earlier part of step 5 is taken back, newest first, and Windows starts as before. The exit message names the log file.

## Taking things back

### While the program is still running

Nothing to do. A failed step undoes the earlier ones (restart cancelled, boot entries deleted, files removed, EFI partition unmounted, partition removed, `C:` grown back to its original size). If an undo step itself fails, the program prints `Could not undo: ...` and its result says which changes are still there; run the installer again (below) or use the by-hand steps for just those items.

### If the program was killed, the power went out, or an undo failed

Run the installer again. Before every step the conversion records what it is about to change in `windows-staging.json` in the state folder (`%USERPROFILE%\.fleet`). The next run reads that record and takes those exact changes back first (the scheduled restart, the boot manager entry, the firmware option, the files on the EFI partition, the partition, the shrink), then starts again from the beginning. Running it twice never leaves two partitions or shrinks `C:` twice. If taking something back fails, it stops before changing anything new and names what is left; use the by-hand steps for that.

Leftovers from installers older than this record cannot be identified for certain. The review then warns about Linux data partitions on the system disk; remove them by hand (step 3 below) if they are Fleet's.

### After "restarting in 15 seconds" but before the restart

`shutdown /a` stops the restart. **The one-time boot is still armed**: the next restart, whenever it is, boots the installer, which erases the disk after a 3 second menu. Either restart on purpose and let the install go ahead, run the installer again (it takes the armed conversion back before anything else), or remove the entries by hand (below).

### Remove everything by hand

All of these in an **administrator** PowerShell or Command Prompt. Do only the parts that apply.

1. **The one-time boot entries.** List them:

   ```cmd
   bcdedit /enum all
   bcdedit /enum firmware
   ```

   Find the blocks whose `description` is `Fleet installer`. There can be two, one from each mechanism. For each one:

   ```cmd
   bcdedit /deletevalue {fwbootmgr} bootsequence
   bcdedit /set {fwbootmgr} displayorder {THE-IDENTIFIER} /remove
   bcdedit /delete {THE-IDENTIFIER}
   ```

   If an entry still shows in the firmware's own boot menu afterwards, delete "Fleet installer" there (the key to open it is usually F12, F10, F9, Esc or F2 at power-on). From Linux, `efibootmgr` lists it and `efibootmgr -B -b 000N` deletes it.

2. **The boot files on the EFI system partition.**

   ```cmd
   mountvol S: /S
   dir S:\EFI\fleet
   type S:\EFI\BOOT\grub.cfg
   ```

   If `grub.cfg` starts with `set timeout=3` and contains `Fleet installer`, it is ours; remove it and the folder. If it is something else, it was already there: leave it.

   ```cmd
   rmdir /s /q S:\EFI\fleet
   del S:\EFI\BOOT\grub.cfg
   mountvol S: /D
   ```

3. **The installer partition.** Find it: it is on the system disk, type `Unknown`, GPT type `{0fc63daf-8483-4772-8e79-3d69d8477de4}`, about the size of the installer, and usually directly after `C:`.

   ```powershell
   Get-Disk
   Get-Partition -DiskNumber 0 | Format-Table PartitionNumber, DriveLetter, Type, GptType, Offset, Size
   Remove-Partition -DiskNumber 0 -PartitionNumber 5
   ```

   Use the disk number and partition number you saw. Remove only a partition you recognise as this one. If you had a Linux partition before, check which is which by size.

4. **Give `C:` its space back.**

   ```powershell
   $max = (Get-PartitionSupportedSize -DriveLetter C).SizeMax
   Resize-Partition -DriveLetter C -Size $max
   ```

   The freed space is directly after `C:`, so this grows it back. (Disk Management > right-click `C:` > Extend Volume does the same.)

5. **The downloaded installer** (several GB): delete `%LOCALAPPDATA%\fleet-installer\fleet-installer.iso` or `~\.fleet\fleet-installer.iso`. On success the program deletes it itself, once it has been written to the partition and read back.

## When it stops half way

| What you see                                                             | What it means and what to do                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `FAIL` line before anything happens                                    | Nothing was changed. Do what the line says and run it again. `--plan` shows the checks without doing anything.                                                                                                                                                                                                                                   |
| `this program is not running as administrator`                           | Close it and open Git Bash with **Run as administrator** (the wizard asks by itself).                                                                                                                                                                                                                                                            |
| `C: can only shrink by ... MiB`                                          | See "C: will not shrink" below. Nothing was changed.                                                                                                                                                                                                                                                                                             |
| `... GiB RAM; the installer is copied into RAM and needs ... GiB`        | Add RAM, or use a bigger computer. A USB install needs the same.                                                                                                                                                                                                                                                                                 |
| `Windows would not let this program write the installer`                 | Windows or a program watching the disk (antivirus, backup, disk tools) refused the raw write, through both the disk and the partition. Everything done so far was undone. Close those programs, restart Windows, run again; or make an install USB.                                                                                              |
| `the partition does not hold the installer after writing`                | The read-back differed. The disk, a cable or the controller may be failing. Everything done so far was undone. Do not convert this machine; make a USB and run its disk check.                                                                                                                                                                   |
| `the EFI system partition has too little free space for the boot loader` | Some PCs ship a 100 MB EFI partition that is nearly full (fonts and language folders under `S:\EFI\Microsoft\Boot` can be deleted, but only if you know what you are doing). Otherwise make an install USB.                                                                                                                                      |
| `no one-time boot entry could be installed and verified`                 | Neither `bcdedit` nor the firmware variables accepted the entry. Everything was undone. Make an install USB, or boot the machine's firmware menu and select the USB.                                                                                                                                                                             |
| `Could not undo: ...`                                                    | That one undo step failed (the line says which). Run the installer again to retry taking it back, or use the matching by-hand step above. Everything else was undone.                                                                                                                                                                            |
| The machine restarts into Windows normally                               | The firmware ignored the one-time choice, or the entry could not be started (e.g. Secure Boot is still on). Nothing was erased. Remove the leftovers (above) or try again after fixing the cause.                                                                                                                                                |
| It restarts to a BitLocker recovery screen                               | Type the recovery key you saved. Windows then starts. Turning Secure Boot back on and starting Windows once usually stops the prompt.                                                                                                                                                                                                            |
| The restart shows a black screen, a `grub>` prompt or a menu that stalls | The one-time choice is spent, so a power cycle goes back to Windows. Hold the power button for 10 seconds, start again, and (if the firmware shows its boot menu) pick _Windows Boot Manager_. Then remove the leftovers (above). Pressing an arrow key during the 3 second menu stops its countdown, so the installer does not start by itself. |
| You are in the Fleet installer menu or text console and want to stop     | Until the installer starts partitioning, nothing on the disk has changed. Hold the power button for 10 seconds, start again, and pick _Windows Boot Manager_ in the firmware's boot menu if Windows does not come up by itself. Once the installer has started erasing, the disk is gone: let it finish, or reinstall from a USB.                |
| The installer ran but shows `FLEET-FAIL` or no internal disk             | Nothing has been erased if it says so before partitioning. With a RAID or Intel RST/VMD controller Linux cannot see the disk: the plan warns about this; switch the firmware's storage mode to AHCI (this can stop Windows from starting, so decide before you start) or use a USB.                                                              |
| The machine keeps booting the installer                                  | The entry is first in the firmware boot order (another tool did that) or `shutdown /a` left it armed. Remove the entries (above) from Windows, or select Windows in the firmware boot menu.                                                                                                                                                      |

### C: will not shrink

Windows can only shrink `C:` down to its last unmovable file. Common causes, in the order to try them:

```cmd
powercfg /h off
```

(turns off hibernation and deletes `hiberfil.sys`; this also turns off Fast Startup), then in _System Properties > System Protection_ turn protection off for `C:` and delete the restore points, set the paging file to "No paging file" for `C:` (restart, then run this program again, then turn it back on if the conversion is cancelled), empty the Recycle Bin and run Disk Cleanup > _Clean up system files_. If it still says the same, `defrag C: /X` consolidates free space and `defrag C: /U /V` shows what blocks it. Moving the blocking file is a Windows problem; making an install USB is always possible instead.

## What is verified and what is not

Verified without Windows (tests in `tests/`):

- Every PowerShell script the program sends is parsed by PowerShell 7's parser (`tests/test_powershell.py`; needs `pwsh` or Docker, and is _skipped_ locally and _fails_ in CI when neither exists), and run against stand-in cmdlets so their property names, pipelines and JSON are exercised. They are single-line, use only single quotes, and read back only JSON and property names, so the language of your Windows does not matter.
- The `Boot####` load option, its device path, the mixed-endian GUID and `BootNext` are checked byte for byte against a hand-derived value, and the `kernel32` calls (privilege, read, write, delete) run against stand-in DLLs.
- The conversion against a model of Windows, with a failure injected at each step: the model always ends up as it started (`tests/test_windows_stage.py`, `tests/test_fleet_node.py`).
- The ISO reader and conversion fixtures include NixOS store paths with repeated slashes, such as `/boot//nix/store/...` (issue #148). CI also reads every role's kernel, initrd and EFI loader from the built ISO before it can be published. This verifies image compatibility; it does not verify a physical firmware handoff.
- Writes at offsets past 4 GiB and past 2 TiB (sparse file), sector alignment, and the retry through the partition's own device.

Not verified, and the first places to look if it fails on real hardware:

1. That GRUB from the installer image, started from a path on the EFI partition, finds its config (`$prefix` is `/EFI/BOOT` on the partition it was loaded from) and then the image in the raw partition.
2. That your firmware honours `BootNext` for an entry that is not first in `BootOrder`, and accepts a short-form `HD()` device path.
3. That `bcdedit /copy {bootmgr}` with a changed `path` produces a firmware entry that really starts GRUB.
4. That `Resize-Partition`, `New-Partition` and the raw write behave on your disk (BitLocker, dynamic disks, RST/VMD, 4Kn drives, vendor drivers).
5. That `mountvol /S` mounts the EFI partition Windows booted from, and that `Get-Partition -DriveLetter` sees it afterwards.
6. That the installer's initrd, booted this way, mounts the partition by its label and copies it to RAM.

</details>
