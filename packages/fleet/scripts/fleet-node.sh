#!/usr/bin/env bash
# Download this one file and run it. No Nix, no git checkout, no just.
# The Python program is embedded below so the file runs by itself.
set -euo pipefail

py=$(command -v python3 || command -v python || true)
if [ -z "$py" ]; then
  echo 'Next: Python 3 is not installed, so nothing was written. Install Python 3 and run this program again.' >&2
  exit 1
fi

payload=$(mktemp)
cleanup() { rm -f "$payload"; }
trap cleanup EXIT

here=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
if [ -f "$here/decide.py" ]; then
  cp "$here/decide.py" "$payload"
else
  sed -n '/^# __DECIDE_PY__$/,/^# __DECIDE_END__$/p' "$0" | sed '1d;$d;s/^# //' > "$payload"
fi

exec "$py" "$payload" "$@"
# __DECIDE_PY__
# #!/usr/bin/env python3
# """Decisions for adding or removing one fleet node.
# 
# The downloadable entry is this program. It does not clone a repository,
# install Nix, or call GitHub's expiring Actions artifact API. Disk writes,
# reboots, and runner calls go through replaceable commands.
# """
# import hashlib
# import json
# import os
# import re
# import select
# import shutil
# import subprocess
# import sys
# import tempfile
# import threading
# from pathlib import Path
# 
# ROLES = ("ci", "web", "cache", "netboot")
# TRAN_RANK = {"nvme": 0, "sata": 1, "ata": 1, "sas": 2, "scsi": 2, "virtio": 3}
# BUS_NAME = {
#     "nvme": "NVMe",
#     "sata": "SATA",
#     "ata": "SATA",
#     "sas": "SAS",
#     "scsi": "SCSI",
#     "virtio": "virtio",
#     "usb": "USB",
# }
# # The release asset does not expire. The Fleet workflow's fleet-installer
# # artifact still lasts 14 days; this program does not download that copy.
# RELEASE_ISO = "https://github.com/crvouga/workspace/releases/download/fleet-installer/fleet-installer.iso"
# DEVICE_RE = re.compile(r"^/dev/[A-Za-z0-9._/:-]+$")
# WINDOWS_RE = re.compile(r"^\\\\\.\\PHYSICALDRIVE[0-9]+$")
# TB = 1000 ** 4
# GB = 1000 ** 3
# SECTOR = 2048
# # The shell initrd can mount these and honor findiso=. NTFS and APFS cannot.
# SAFE_ISO_FS = frozenset({"ext2", "ext3", "ext4", "btrfs", "xfs", "vfat"})
# # Win32_DiskDrive.BusType is a uint16. [string] on the live value is the digit.
# WINDOWS_BUS = {
#     "17": "nvme",
#     "11": "sata",
#     "7": "usb",
#     "10": "sas",
#     "3": "ata",
#     "2": "ata",
#     "1": "scsi",
# }
# 
# 
# def say(message):
#     print(message, file=sys.stderr)
# 
# 
# def fail(message, code=1):
#     say(message)
#     return code
# 
# 
# def flag(value):
#     if value is True:
#         return True
#     if value in (False, None, "", 0, "0"):
#         return False
#     if isinstance(value, str) and value.strip().lower() in ("false", "no"):
#         return False
#     try:
#         return int(value) != 0
#     except (TypeError, ValueError):
#         return bool(value)
# 
# 
# def size_label(size):
#     try:
#         number = int(size)
#     except (TypeError, ValueError):
#         return "0 bytes"
#     if number >= TB:
#         whole, rem = divmod(number, TB)
#         return f"{whole}.{rem // (TB // 10)} TB"
#     if number >= GB:
#         whole, rem = divmod(number, GB)
#         return f"{whole}.{rem // (GB // 10)} GB"
#     return f"{number} bytes"
# 
# 
# def plain_name(disk):
#     model = (disk.get("model") or "disk").strip() or "disk"
#     size = size_label(disk.get("size") or 0)
#     if disk.get("usb") or disk.get("rm"):
#         return f"USB disk, {size}, {model}"
#     bus = BUS_NAME.get(disk.get("tran") or "", "disk")
#     return f"internal {bus}, {size}, {model}"
# 
# 
# def disk_id(disk):
#     serial = re.sub(r"\s+", "", str(disk.get("serial") or "")).lower()
#     if serial:
#         basis = serial
#     else:
#         basis = "|".join([
#             str(disk.get("model") or ""),
#             str(disk.get("size") or ""),
#             str(disk.get("tran") or ""),
#         ])
#     return hashlib.sha256(basis.encode()).hexdigest()[:16]
# 
# 
# def device_ok(path):
#     return bool(DEVICE_RE.fullmatch(path or "") or WINDOWS_RE.fullmatch(path or ""))
# 
# 
# def mounted_tree(device):
#     points = device.get("mountpoints") or []
#     if any(point for point in points):
#         return True
#     return any(mounted_tree(child) for child in device.get("children") or [])
# 
# 
# def parse_lsblk(raw):
#     data = json.loads(raw)
#     disks = []
#     for device in data.get("blockdevices") or []:
#         if device.get("type") != "disk":
#             continue
#         tran = str(device.get("tran") or "").lower()
#         usb = tran == "usb"
#         disks.append({
#             "path": str(device.get("path") or ""),
#             "tran": tran,
#             "rm": flag(device.get("rm")),
#             "hotplug": flag(device.get("hotplug")) or usb,
#             "usb": usb,
#             "internal": tran in TRAN_RANK and not usb,
#             "mounted": mounted_tree(device),
#             "whole": True,
#             "size": device.get("size") or 0,
#             "model": str(device.get("model") or "").strip(),
#             "serial": str(device.get("serial") or "").strip(),
#         })
#     return disks
# 
# 
# def _info_map(text):
#     fields = {}
#     for line in text.splitlines():
#         if ":" not in line:
#             continue
#         key, value = line.split(":", 1)
#         fields[key.strip().lower()] = value.strip()
#     return fields
# 
# 
# def _yes(fields, key):
#     return fields.get(key, "").lower().startswith("y")
# 
# 
# def _removable_phrase(value):
#     """diskutil prints Yes/No in fixtures and Fixed/Removable on a live Mac."""
#     text = str(value or "").strip().lower()
#     return text in {"yes", "true", "removable"} or text.startswith("y")
# 
# 
# def _mounted_phrase(value):
#     """Yes is mounted. No and 'Not applicable (no file system)' are not."""
#     text = str(value or "").strip().lower()
#     if not text or text.startswith("n"):
#         return False
#     return text.startswith("y") or text == "mounted" or text == "true"
# 
# 
# def parse_diskutil_info(text):
#     fields = _info_map(text)
#     protocol_l = fields.get("protocol", "").lower()
#     location = fields.get("device location", "").lower()
#     virtual = _yes(fields, "virtual")
#     internal = _yes(fields, "internal") or location == "internal"
#     removable = _removable_phrase(fields.get("removable media", ""))
#     # Apple silicon diskutil names the internal SSD "Apple Fabric", not PCI-Express.
#     usb = "usb" in protocol_l or (removable and not internal)
#     hotplug = usb or _yes(fields, "hotplug") or location in ("external", "hotplug")
#     if "nvme" in protocol_l or "pci" in protocol_l or "apple fabric" in protocol_l:
#         tran = "nvme"
#     elif "sata" in protocol_l or "ata" in protocol_l:
#         tran = "sata"
#     elif usb:
#         tran = "usb"
#     elif "sas" in protocol_l:
#         tran = "sas"
#     elif "scsi" in protocol_l or "virtio" in protocol_l:
#         tran = "scsi"
#     else:
#         tran = "other"
#     size = 0
#     match = re.search(r"\((\d+) Bytes\)", fields.get("disk size", ""))
#     if match:
#         size = int(match.group(1))
#     path = fields.get("device node", "")
#     return {
#         "path": path,
#         "tran": tran,
#         "rm": removable or usb,
#         "hotplug": hotplug,
#         "usb": usb,
#         "internal": internal and not usb and not virtual,
#         "mounted": _mounted_phrase(fields.get("mounted", "")),
#         "whole": _yes(fields, "whole") or not fields.get("whole"),
#         "size": size,
#         "model": fields.get("device / media name", "").strip(),
#         "serial": fields.get("serial number", "").strip(),
#         "virtual": virtual,
#     }
# 
# 
# def _windows_mounted(device):
#     """Mounted means a logical volume is attached. A boolean is not the query."""
#     volumes = device.get("Volumes", None)
#     if volumes is None:
#         volumes = device.get("volumes")
#     if isinstance(volumes, str):
#         return bool(volumes.strip())
#     if isinstance(volumes, (list, tuple)):
#         return any(str(item or "").strip() for item in volumes)
#     return False
# 
# 
# def parse_windows(raw):
#     data = json.loads(raw)
#     if isinstance(data, dict):
#         data = [data]
#     disks = []
#     for device in data:
#         interface = str(device.get("InterfaceType") or "")
#         bus_value = device.get("BusType")
#         if bus_value is None or str(bus_value).strip() == "":
#             bus = interface.strip()
#         else:
#             bus = str(bus_value).strip()
#         media = str(device.get("MediaType") or "")
#         pnp = str(device.get("PNPDeviceID") or "")
#         bus_l = bus.lower()
#         coded = WINDOWS_BUS.get(bus_l)
#         usb = coded == "usb" or "usb" in bus_l or "usb" in pnp.lower() or "removable" in media.lower()
#         if coded and coded != "usb":
#             tran = coded
#         elif "nvme" in bus_l:
#             tran = "nvme"
#         elif "sata" in bus_l or "ata" in bus_l or "ide" in bus_l:
#             tran = "sata"
#         elif "sas" in bus_l:
#             tran = "sas"
#         elif usb:
#             tran = "usb"
#         elif "scsi" in bus_l:
#             tran = "scsi"
#         else:
#             tran = "other"
#         path = str(device.get("DeviceID") or "")
#         disks.append({
#             "path": path,
#             "tran": tran,
#             "rm": usb or "removable" in media.lower(),
#             "hotplug": usb or flag(device.get("Hotplug")),
#             "usb": usb,
#             "internal": not usb and tran in TRAN_RANK and "removable" not in media.lower(),
#             "mounted": _windows_mounted(device),
#             "whole": True,
#             "size": device.get("Size") or 0,
#             "model": str(device.get("Model") or "").strip(),
#             "serial": str(device.get("SerialNumber") or "").strip(),
#         })
#     return disks
# 
# 
# def _run(command):
#     completed = subprocess.run(command, check=False, capture_output=True, text=True)
#     if completed.returncode != 0:
#         detail = (completed.stderr or completed.stdout or "").strip()
#         raise RuntimeError(detail or f"{command[0]} failed")
#     return completed.stdout
# 
# 
# def collect(os_name):
#     if os_name == "Linux":
#         tool = os.environ.get("FLEET_LSBLK", "lsblk")
#         raw = _run([
#             tool, "--json", "--bytes", "--paths", "--output",
#             "PATH,TYPE,TRAN,RM,HOTPLUG,SIZE,MODEL,SERIAL,MOUNTPOINTS",
#         ])
#         return parse_lsblk(raw)
#     if os_name == "Darwin":
#         tool = os.environ.get("FLEET_DISKUTIL", "diskutil")
#         listing = _run([tool, "list"])
#         nodes = re.findall(r"^(/dev/disk[0-9]+)\b", listing, re.M)
#         disks = []
#         for node in nodes:
#             info = _run([tool, "info", node])
#             parsed = parse_diskutil_info(info)
#             if parsed.get("virtual"):
#                 continue
#             if not parsed["path"]:
#                 parsed["path"] = node
#             disks.append(parsed)
#         return disks
#     if os_name == "Windows":
#         tool = os.environ.get("FLEET_POWERSHELL") or shutil.which("powershell.exe") or "powershell"
#         script = (
#             "$rows = Get-CimInstance Win32_DiskDrive | ForEach-Object { "
#             "$parts = @($_ | Get-CimAssociatedInstance -ResultClassName Win32_DiskPartition); "
#             "$letters = @(); "
#             "foreach ($part in $parts) { "
#             "$vols = @($part | Get-CimAssociatedInstance -ResultClassName Win32_LogicalDisk); "
#             "foreach ($vol in $vols) { if ($vol.DeviceID) { $letters += [string]$vol.DeviceID } } "
#             "}; "
#             "[PSCustomObject]@{ DeviceID=$_.DeviceID; Model=$_.Model; Size=[int64]$_.Size; "
#             "InterfaceType=[string]$_.InterfaceType; BusType=[string]$_.BusType; "
#             "MediaType=[string]$_.MediaType; PNPDeviceID=$_.PNPDeviceID; "
#             "SerialNumber=$_.SerialNumber; Volumes=$letters } }; "
#             "$rows | ConvertTo-Json -Compress -Depth 4"
#         )
#         raw = _run([tool, "-NoProfile", "-Command", script])
#         return parse_windows(raw)
#     raise RuntimeError(f"unsupported operating system {os_name}")
# 
# 
# def install_block(disk):
#     if not disk.get("whole"):
#         return "partition"
#     if not device_ok(disk.get("path") or ""):
#         return "path"
#     if disk.get("usb") or disk.get("tran") == "usb":
#         return "usb"
#     if disk.get("rm"):
#         return "removable"
#     if disk.get("hotplug"):
#         return "hotplug"
#     if disk.get("mounted"):
#         return "mounted"
#     if disk.get("tran") not in TRAN_RANK or not disk.get("internal"):
#         return "external"
#     return None
# 
# 
# def media_block(disk):
#     if not disk.get("whole"):
#         return "partition"
#     if not device_ok(disk.get("path") or ""):
#         return "path"
#     if disk.get("internal") and not disk.get("usb") and not disk.get("rm"):
#         return "internal"
#     if disk.get("mounted"):
#         return "mounted"
#     if not (disk.get("usb") or disk.get("rm")):
#         return "not-removable"
#     return None
# 
# 
# def plan_disks(disks, action):
#     block = install_block if action == "install" else media_block
#     eligible = []
#     reasons = []
#     for disk in disks:
#         reason = block(disk)
#         if reason is None:
#             eligible.append(disk)
#         else:
#             reasons.append(reason)
#     if len(eligible) == 1:
#         chosen = eligible[0]
#         return {
#             "ok": True,
#             "plain": plain_name(chosen),
#             "disk_id": disk_id(chosen),
#             "path": chosen["path"],
#         }
#     if len(eligible) > 1:
#         if action == "install":
#             message = "Next: more than one internal disk was found. Disconnect the extra disk and run this program again. Nothing was written."
#         else:
#             message = "Next: more than one USB disk was found. Unplug the extra one and run this program again. Nothing was written."
#         return {"ok": False, "next": message, "code": 2}
#     if action == "install":
#         if "mounted" in reasons:
#             message = "Next: the internal disk is mounted. Nothing was written. Plug in one USB disk and run this program again with the word flash."
#         elif "hotplug" in reasons:
#             message = "Next: the only disk is hotplug. Use the fixed internal disk and run this program again. Nothing was written."
#         elif "removable" in reasons or "usb" in reasons:
#             message = "Next: this program will not install a role onto a USB or removable disk. Connect the internal disk and run this program again. Nothing was written."
#         elif "external" in reasons:
#             message = "Next: no fixed internal disk was found. Connect that disk and run this program again. Nothing was written."
#         else:
#             message = "Next: no internal disk can be erased. Connect the internal disk and run this program again. Nothing was written."
#     elif "internal" in reasons:
#         message = "Next: refusing to write the installer onto an internal disk. Plug in one USB disk and run this program again. Nothing was written."
#     elif "mounted" in reasons:
#         message = "Next: the USB disk is mounted. Unmount it and run this program again. Nothing was written."
#     else:
#         message = "Next: no USB disk was found. Plug in one USB disk and run this program again. Nothing was written."
#     return {"ok": False, "next": message, "code": 2}
# 
# 
# def role_error(role):
#     if role == "ci-gpu":
#         return "Next: ci-gpu is not on the shared installer. Choose ci, web, cache, or netboot. Nothing was written."
#     if role not in ROLES:
#         return "Next: the role must be ci, web, cache, or netboot. Nothing was written."
#     return None
# 
# 
# def confirm(role, plain, answer, timed_out):
#     if timed_out:
#         return "Next: no answer arrived in time. Nothing was written. Run this program again and stay at the keyboard."
#     if answer.strip() == "":
#         return "Next: the confirmation was empty. Nothing was written. Run this program again and type the line this program shows."
#     expected = f"{role}: {plain}"
#     if answer.strip() != expected:
#         return "Next: the confirmation did not match. Nothing was written. Run this program again and type the line exactly."
#     return None
# 
# 
# def removal_plan(busy, credential, withdrawn, role):
#     """Never stop a running job. stop_job is always false."""
#     if busy:
#         if not credential:
#             return {
#                 "action": "refuse",
#                 "code": 1,
#                 "stop_job": False,
#                 "power_off": False,
#                 "next": "Next: a job is running and this machine has no credential to withdraw itself. Leave the machine on.",
#             }
#         return {
#             "action": "hold",
#             "code": 0,
#             "stop_job": False,
#             "power_off": False,
#             "next": "Next: a job is still running. This machine was not stopped. Leave it on and run this program again when the job has finished.",
#         }
#     if withdrawn:
#         return {"action": "noop", "code": 0, "stop_job": False, "power_off": True, "next": ""}
#     if role in ("web", "cache", "netboot"):
#         return {"action": "retire", "code": 0, "stop_job": False, "power_off": True, "next": ""}
#     if not credential:
#         return {
#             "action": "refuse",
#             "code": 1,
#             "stop_job": False,
#             "power_off": False,
#             "next": "Next: no credential is on this machine, so this program did not withdraw it. Restore the runner key that is already kept on this machine, then run this program again.",
#         }
#     return {"action": "withdraw", "code": 0, "stop_job": False, "power_off": True, "next": ""}
# 
# 
# def _host_is_windows():
#     """Win32 CPython has no os.uname. Classify before calling it."""
#     if os.name == "nt":
#         return True
#     platform = str(getattr(sys, "platform", "")).lower()
#     return platform.startswith(("win", "cygwin", "msys", "mingw"))
# 
# 
# def current_os():
#     override = os.environ.get("FLEET_OS")
#     if override:
#         if override in ("Windows", "MINGW", "MSYS", "CYGWIN"):
#             return "Windows"
#         if override == "Darwin":
#             return "Darwin"
#         if override == "Linux":
#             return "Linux"
#         return override
#     if _host_is_windows():
#         return "Windows"
#     uname = getattr(os, "uname", None)
#     if uname is None:
#         return "unknown"
#     try:
#         name = uname().sysname
#     except AttributeError:
#         return "unknown"
#     if name.startswith(("MINGW", "MSYS", "CYGWIN")):
#         return "Windows"
#     return name
# 
# 
# def state_dir():
#     chosen = os.environ.get("FLEET_STATE")
#     if chosen:
#         return Path(chosen)
#     nix = Path("/nix/fleet-state")
#     if nix.is_dir():
#         return nix
#     return Path.home() / ".fleet"
# 
# 
# def read_kv(path):
#     data = {}
#     file = Path(path)
#     if not file.is_file():
#         return data
#     for line in file.read_text(encoding="utf-8").splitlines():
#         if not line or line.startswith("#") or "=" not in line:
#             continue
#         key, value = line.split("=", 1)
#         key = key.strip()
#         value = value.strip()
#         if key == "target":
#             data.setdefault("targets", []).append(value)
#         else:
#             data[key] = value
#     return data
# 
# 
# def marker_text(path):
#     file = Path(path)
#     if not file.is_file():
#         return {}
#     return read_kv(file)
# 
# 
# def write_text(path, text):
#     path = Path(path)
#     path.parent.mkdir(parents=True, exist_ok=True)
#     temporary = path.with_suffix(path.suffix + ".tmp")
#     temporary.write_text(text, encoding="utf-8")
#     os.chmod(temporary, 0o644)
#     os.replace(temporary, path)
# 
# 
# def installed_for(role, directory):
#     marker = marker_text(Path(directory) / "installed")
#     return marker.get("status") == "installed" and marker.get("role") == role
# 
# 
# def _read_line_timed(seconds):
#     """Wait without select. Win32 raises OSError on console stdin."""
#     holder = {}
# 
#     def _read():
#         try:
#             holder["line"] = sys.stdin.readline()
#         except Exception as exc:
#             holder["error"] = exc
# 
#     worker = threading.Thread(target=_read, daemon=True)
#     worker.start()
#     worker.join(seconds)
#     if worker.is_alive():
#         return "", True
#     if "error" in holder:
#         raise holder["error"]
#     line = holder.get("line", "")
#     if line == "":
#         return "", False
#     return line.rstrip("\n"), False
# 
# 
# def read_answer(timeout):
#     try:
#         seconds = int(timeout)
#     except (TypeError, ValueError):
#         seconds = 120
#     if seconds < 1:
#         seconds = 1
#     # FLEET_STDIN_WAIT=windows exercises this branch on hosts that are not Windows.
#     if os.name == "nt" or os.environ.get("FLEET_STDIN_WAIT") == "windows":
#         return _read_line_timed(seconds)
#     try:
#         ready, _, _ = select.select([sys.stdin], [], [], seconds)
#     except OSError:
#         return _read_line_timed(seconds)
#     if not ready:
#         return "", True
#     line = sys.stdin.readline()
#     if line == "":
#         return "", False
#     return line.rstrip("\n"), False
# 
# 
# def installer_urls():
#     iso = os.environ.get("FLEET_INSTALLER_URL") or RELEASE_ISO
#     checksum = os.environ.get("FLEET_INSTALLER_SHA256_URL") or (iso + ".sha256")
#     return iso, checksum
# 
# 
# def curl_to(url, dest):
#     tool = os.environ.get("FLEET_CURL", "curl")
#     completed = subprocess.run(
#         [tool, "-fsSL", "--retry", "3", "-o", str(dest), url],
#         check=False,
#         capture_output=True,
#         text=True,
#     )
#     if completed.returncode != 0:
#         raise RuntimeError("download failed")
#     return Path(dest).read_bytes()
# 
# 
# def file_sha256(path):
#     digest = hashlib.sha256()
#     with open(path, "rb") as handle:
#         for chunk in iter(lambda: handle.read(1024 * 1024), b""):
#             digest.update(chunk)
#     return digest.hexdigest()
# 
# 
# def fetch_installer(dest):
#     """Copy the durable installer to dest. Leave dest untouched on failure."""
#     dest = Path(dest)
#     iso_url, sum_url = installer_urls()
#     temporary = Path(tempfile.mkdtemp(prefix="fleet-fetch-"))
#     try:
#         body_path = temporary / "body"
#         sum_path = temporary / "sum"
#         try:
#             body = curl_to(iso_url, body_path)
#         except (OSError, RuntimeError):
#             return fail("Next: the installer could not be downloaded. Check the network and run this program again. Nothing was written.")
#         if not body or b"artifact has expired" in body.lower():
#             return fail("Next: the installer download is missing or expired. Nothing was written. Run this program again after the durable installer is published.")
#         try:
#             checksum_body = curl_to(sum_url, sum_path)
#         except (OSError, RuntimeError):
#             return fail("Next: the installer checksum could not be downloaded. Nothing was written. Run this program again.")
#         expected = checksum_body.decode("utf-8", "replace").split()
#         if not expected or not re.fullmatch(r"[0-9a-fA-F]{64}", expected[0]):
#             return fail("Next: the installer checksum was not valid. Nothing was written. Run this program again.")
#         actual = file_sha256(body_path)
#         if actual.lower() != expected[0].lower():
#             return fail("Next: the installer download did not match its checksum. Nothing was written. Run this program again.")
#         dest.parent.mkdir(parents=True, exist_ok=True)
#         if dest.is_file() and dest.read_bytes() == body:
#             return 0
#         staged = dest.with_suffix(dest.suffix + ".partial")
#         staged.write_bytes(body)
#         os.replace(staged, dest)
#         return 0
#     finally:
#         shutil.rmtree(temporary, ignore_errors=True)
# 
# 
# def os_boot_tool(os_name):
#     if os_name == "Darwin":
#         return os.environ.get("FLEET_DARWIN_BOOT", "kexec")
#     if os_name == "Windows":
#         return os.environ.get("FLEET_WINDOWS_BOOT", "kexec")
#     return os.environ.get("FLEET_KEXEC", "kexec")
# 
# 
# def _le32(buf, offset):
#     return int.from_bytes(buf[offset:offset + 4], "little")
# 
# 
# def _susp_entries(blob):
#     offset = 0
#     while offset + 4 <= len(blob):
#         length = blob[offset + 2]
#         if length < 4 or offset + length > len(blob):
#             break
#         yield blob[offset:offset + 2], blob[offset:offset + length]
#         offset += length
# 
# 
# def _rock_ridge_name(system_use, handle):
#     """Prefer the Rock Ridge name. A bad continuation falls back to the ISO name."""
#     try:
#         pending = system_use
#         parts = []
#         for _ in range(8):
#             if not pending:
#                 break
#             nxt = None
#             for sig, entry in _susp_entries(pending):
#                 if sig == b"NM" and len(entry) >= 5 and not (entry[4] & 0x06):
#                     parts.append(entry[5:])
#                 elif sig == b"CE" and len(entry) >= 28:
#                     loc = _le32(entry, 4)
#                     off = _le32(entry, 12)
#                     length = _le32(entry, 20)
#                     handle.seek(loc * SECTOR + off)
#                     nxt = handle.read(length)
#             pending = nxt
#         if not parts:
#             return None
#         name = b"".join(parts).decode("utf-8", "strict")
#     except (OSError, UnicodeError, ValueError):
#         return None
#     if not name or name in (".", "..") or "/" in name or "\x00" in name:
#         return None
#     return name
# 
# 
# def _iso_name(ident):
#     if ident == b"\x00":
#         return "."
#     if ident == b"\x01":
#         return ".."
#     text = ident.split(b";", 1)[0].decode("utf-8", "replace").rstrip(".")
#     if not text or "/" in text or "\x00" in text:
#         return None
#     return text
# 
# 
# def _record_name(record, handle):
#     name_len = record[32]
#     if 33 + name_len > len(record):
#         return None
#     su_off = 33 + name_len
#     if su_off % 2:
#         su_off += 1
#     rock = _rock_ridge_name(record[su_off:], handle)
#     if rock:
#         return rock
#     return _iso_name(record[33:33 + name_len])
# 
# 
# def _directory_records(handle, extent, size):
#     handle.seek(extent * SECTOR)
#     data = handle.read(size)
#     offset = 0
#     while offset + 1 < len(data):
#         if data[offset] == 0:
#             offset = ((offset // SECTOR) + 1) * SECTOR
#             continue
#         length = data[offset]
#         if length < 34 or offset + length > len(data):
#             break
#         yield data[offset:offset + length]
#         offset += length
# 
# 
# def _iso_index(handle):
#     handle.seek(16 * SECTOR)
#     pvd = handle.read(SECTOR)
#     if len(pvd) < 190 or pvd[0] != 1 or pvd[1:6] != b"CD001":
#         raise ValueError("not an ISO9660 installer")
#     root_len = pvd[156]
#     if root_len < 34 or 156 + root_len > len(pvd):
#         raise ValueError("installer volume has no root directory")
#     files = {}
# 
#     def walk(record, prefix):
#         for child in _directory_records(handle, _le32(record, 2), _le32(record, 10)):
#             name = _record_name(child, handle)
#             if not name or name in (".", ".."):
#                 continue
#             path = f"{prefix}/{name}" if prefix else name
#             if child[25] & 0x02:
#                 walk(child, path)
#             else:
#                 files[path] = (_le32(child, 2), _le32(child, 10))
# 
#     walk(pvd[156:156 + root_len], "")
#     return files
# 
# 
# def _iso_bytes(handle, files, path):
#     key = path.lstrip("/")
#     if key not in files:
#         folded = {name.lower(): name for name in files}
#         key = folded.get(key.lower())
#     if key is None:
#         raise ValueError(f"missing {path}")
#     extent, size = files[key]
#     if size <= 0 or size > 512 * 1024 * 1024:
#         raise ValueError(f"unusable {path}")
#     handle.seek(extent * SECTOR)
#     body = handle.read(size)
#     if len(body) != size:
#         raise ValueError(f"short {path}")
#     return body
# 
# 
# def _boot_blocks(text):
#     blocks = []
#     current = {}
#     for raw in text.splitlines():
#         line = raw.strip()
#         if not line or line.startswith("#"):
#             continue
#         head, _, rest = line.partition(" ")
#         head = head.upper()
#         if head == "LABEL":
#             if current.get("linux") and current.get("initrd"):
#                 blocks.append(current)
#             current = {"label": rest.strip()}
#         elif head == "LINUX" and rest.strip():
#             current["linux"] = rest.strip()
#         elif head == "INITRD" and rest.strip():
#             current["initrd"] = rest.strip()
#         elif head == "APPEND":
#             current["append"] = rest.strip()
#     if current.get("linux") and current.get("initrd"):
#         blocks.append(current)
#     return blocks
# 
# 
# def _choose_block(blocks, role):
#     want = f"fleet.role={role}"
#     matches = [block for block in blocks if want in block.get("append", "").split()]
#     if not matches:
#         raise ValueError(f"no {role} boot entry")
#     preferred = "boot" if role == "ci" else f"boot-{role}"
#     for block in matches:
#         if block.get("label") == preferred:
#             return block
#     return sorted(matches, key=lambda block: (len(block.get("label", "")), block.get("label", "")))[0]
# 
# 
# def iso_filesystem(path):
#     override = os.environ.get("FLEET_ISO_FS")
#     if override is not None and override.strip() != "":
#         return override.strip().lower()
#     tool = os.environ.get("FLEET_FINDMNT", "findmnt")
#     if shutil.which(tool) is None and not os.path.isfile(tool):
#         return ""
#     completed = subprocess.run(
#         [tool, "-n", "-o", "FSTYPE", "-T", str(path)],
#         check=False,
#         capture_output=True,
#         text=True,
#     )
#     if completed.returncode != 0 or not completed.stdout.strip():
#         return ""
#     return completed.stdout.strip().splitlines()[0].strip().lower()
# 
# 
# def extract_boot(iso_path, role):
#     """Pull the role's kernel and initrd out of the installer ISO."""
#     iso_path = Path(iso_path)
#     with iso_path.open("rb") as handle:
#         files = _iso_index(handle)
#         config = _iso_bytes(handle, files, "isolinux/isolinux.cfg").decode("utf-8", "replace")
#         block = _choose_block(_boot_blocks(config), role)
#         kernel = _iso_bytes(handle, files, block["linux"])
#         initrd = _iso_bytes(handle, files, block["initrd"])
#     directory = iso_path.parent / "boot-files"
#     directory.mkdir(parents=True, exist_ok=True)
#     kernel_path = directory / "kernel"
#     initrd_path = directory / "initrd"
#     kernel_path.write_bytes(kernel)
#     initrd_path.write_bytes(initrd)
#     return str(kernel_path), str(initrd_path), block.get("append", "")
# 
# 
# def _boot_command(append, role, iso_path):
#     tokens = append.split()
#     if any(any(char.isspace() for char in token) for token in tokens):
#         raise ValueError("boot command is not one line")
#     iso_abs = str(Path(iso_path).resolve())
#     if iso_abs == "" or any(char.isspace() for char in iso_abs):
#         raise ValueError("installer path is not a single word")
#     extras = ["copytoram", f"findiso={iso_abs}"]
#     role_token = f"fleet.role={role}"
#     kept = [token for token in tokens if token not in extras and token != role_token]
#     return " ".join([*kept, *extras, role_token])
# 
# 
# def stage_reboot(os_name, role, iso):
#     """Load the ISO's own kernel. The shell initrd finds the file and copies it to RAM."""
#     tool = os_boot_tool(os_name)
#     flash = "Next: this computer cannot reboot into the installer. Nothing was written. Plug in one USB disk and run this program again with the word flash."
#     if shutil.which(tool) is None and not os.path.isfile(tool):
#         say(flash)
#         return 1
#     if iso_filesystem(iso) not in SAFE_ISO_FS:
#         say(flash)
#         return 1
#     try:
#         kernel, initrd, append = extract_boot(iso, role)
#         cmdline = _boot_command(append, role, iso)
#     except (OSError, ValueError):
#         say("Next: the installer image could not be read. Nothing was written. Plug in one USB disk and run this program again with the word flash.")
#         return 1
#     load = subprocess.run(
#         [tool, "--load", kernel, f"--initrd={initrd}", f"--command-line={cmdline}"],
#         check=False,
#     )
#     if load.returncode != 0:
#         say(flash)
#         return load.returncode or 1
#     execute = subprocess.run([tool, "-e"], check=False)
#     if execute.returncode != 0:
#         say(flash)
#         return execute.returncode or 1
#     return 0
# 
# 
# def write_media(os_name, iso, device):
#     if not device_ok(device):
#         say("Next: the USB disk path was not usable. Nothing was written. Run this program again.")
#         return 1
#     tool = os.environ.get("FLEET_DD", "dd")
#     if os_name == "Darwin" and device.startswith("/dev/"):
#         target = "/dev/r" + device[len("/dev/"):]
#         block = "bs=4m"
#     else:
#         target = device
#         block = "bs=4M"
#     completed = subprocess.run(
#         [tool, f"if={iso}", f"of={target}", block],
#         check=False,
#         stdout=subprocess.DEVNULL,
#         stderr=subprocess.DEVNULL,
#     )
#     if completed.returncode != 0:
#         say("Next: the USB disk could not be written. Nothing else was written. Run this program again from an administrator account.")
#         return 1
#     return 0
# 
# 
# def load_role(argv_role):
#     if argv_role:
#         return argv_role.strip()
#     say("Type the role (ci, web, cache, or netboot):")
#     answer, timed_out = read_answer(os.environ.get("FLEET_CONFIRM_TIMEOUT", "120"))
#     if timed_out or answer.strip() == "":
#         say("Next: the role was not given. Nothing was written. Run this program again and type ci, web, cache, or netboot.")
#         return None
#     return answer.strip()
# 
# 
# def choose_disk(os_name, action):
#     try:
#         disks = collect(os_name)
#     except (OSError, RuntimeError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
#         return {"ok": False, "code": 2, "next": f"Next: the disks could not be listed ({exc}). Nothing was written. Run this program again."}
#     return plan_disks(disks, action)
# 
# 
# def cmd_fetch(argv):
#     if len(argv) != 1:
#         return fail("Next: give the file name where the installer should be saved. Nothing was written.", 2)
#     return fetch_installer(argv[0])
# 
# 
# def cmd_install(argv, action):
#     os_name = current_os()
#     if os_name not in ("Linux", "Darwin", "Windows"):
#         return fail(f"Next: {os_name} cannot start this installer. Nothing was written.", 2)
#     role = None
#     if action == "install":
#         role = load_role(argv[0] if argv else "")
#         if role is None:
#             return 1
#         error = role_error(role)
#         if error:
#             return fail(error, 2)
#         if argv and len(argv) > 1:
#             return fail("Next: pass only the role. Nothing was written.", 2)
#     elif argv:
#         return fail("Next: flash takes no role. Nothing was written.", 2)
#     directory = state_dir()
#     chosen = choose_disk(os_name, action)
#     if not chosen["ok"]:
#         return fail(chosen["next"], chosen.get("code", 2))
#     if action == "install":
#         say(f"Role: {role}")
#         say(f"Disk: {chosen['plain']}")
#         say("This erases that internal disk. Nothing is erased until you confirm the role and the disk.")
#         say("Type this line exactly:")
#         say(f"{role}: {chosen['plain']}")
#         label = role
#     else:
#         say("Disk: " + chosen["plain"])
#         say("This writes the installer onto that USB disk and erases what is on it. The internal disk is not erased.")
#         say("Type this line exactly:")
#         say("flash: " + chosen["plain"])
#         label = "flash"
#     answer, timed_out = read_answer(os.environ.get("FLEET_CONFIRM_TIMEOUT", "120"))
#     error = confirm(label, chosen["plain"], answer, timed_out)
#     if error:
#         return fail(error, 1)
#     again = choose_disk(os_name, action)
#     if not again["ok"] or again["disk_id"] != chosen["disk_id"]:
#         return fail("Next: the disk changed before it was used. Nothing was written. Run this program again.")
#     if action == "install" and installed_for(role, directory):
#         say(f"This machine is already installed as {role}. The disk was not wiped.")
#         return 0
#     iso = directory / "fleet-installer.iso"
#     fetched = fetch_installer(iso)
#     if fetched != 0:
#         return fetched
#     if action == "install":
#         staged = stage_reboot(os_name, role, str(iso))
#         if staged != 0:
#             return staged
#         say(f"FLEET-WIPE role={role}")
#         write_text(directory / "installed", f"role={role}\ndisk={chosen['disk_id']}\nstatus=installed\n")
#         say(f"Installed role {role}. The hostname is chosen from the hardware id when the machine boots.")
#         return 0
#     written = write_media(os_name, str(iso), chosen["path"])
#     if written != 0:
#         return written
#     say("FLEET-WIPE media")
#     say("The USB disk now holds the installer. Boot that disk. On the installer menu choose ci, web, cache, or netboot. The menu installs ci after 5 seconds.")
#     return 0
# 
# 
# def job_busy(directory):
#     root = Path(directory)
#     if not root.exists():
#         return False
#     for candidate in root.rglob("busy"):
#         if candidate.is_file():
#             return True
#     return False
# 
# 
# def credential_ready(key_path, conf):
#     if not key_path or not os.path.isfile(key_path) or os.path.getsize(key_path) == 0:
#         return False
#     if not conf:
#         return False
#     for field in ("scope", "app_id", "installation_id"):
#         value = str(conf.get(field) or "")
#         if not value or "TODO" in value:
#             return False
#     targets = conf.get("targets") or []
#     if not targets or any("TODO" in target for target in targets):
#         return False
#     if conf.get("scope") not in ("organization", "repository"):
#         return False
#     return True
# 
# 
# def node_role(conf):
#     role = (conf or {}).get("role", "")
#     if role in ROLES:
#         return role
#     return ""
# 
# 
# def call_runner(mode, conf, key_path, host):
#     tool = os.environ.get("FLEET_RUNNER_CONTROL", "runner-control")
#     for target in conf.get("targets") or []:
#         completed = subprocess.run(
#             [tool, mode, conf["scope"], target, conf["app_id"], conf["installation_id"], key_path, host],
#             check=False,
#         )
#         if completed.returncode != 0:
#             return completed.returncode
#     return 0
# 
# 
# def cmd_remove():
#     directory = state_dir()
#     busy_root = os.environ.get("FLEET_BUSY_DIR", "/run/fleet")
#     key_path = os.environ.get("FLEET_CREDENTIAL", "/run/secrets/github-app-key")
#     node = read_kv(os.environ.get("FLEET_NODE_CONF", "/etc/fleet/node.conf"))
#     runner = read_kv(os.environ.get("FLEET_RUNNER_CONF", "/etc/fleet/runner.conf"))
#     role = node_role(node)
#     busy = job_busy(busy_root)
#     withdrawn = (directory / "withdrawn").is_file()
#     ready = credential_ready(key_path, runner)
#     plan = removal_plan(busy, ready, withdrawn, role)
#     if plan["stop_job"]:
#         return fail("Next: refusing to stop a running job. Leave this machine on.", 1)
#     if plan["action"] in ("hold", "withdraw"):
#         host = os.environ.get("FLEET_HOSTNAME")
#         if not host:
#             try:
#                 host = _run(["hostname"]).strip()
#             except (OSError, RuntimeError):
#                 return fail("Next: this machine has no hostname to withdraw. Nothing was stopped. Run this program again on the node.")
#         code = call_runner(plan["action"], runner, key_path, host)
#         if code != 0:
#             return fail("Next: the runner could not be withdrawn with the credential already on this machine. Nothing was stopped. Run this program again.", code)
#     if plan["action"] == "refuse":
#         return fail(plan["next"], plan["code"])
#     if plan["next"]:
#         say(plan["next"])
#     if plan["power_off"]:
#         if not withdrawn:
#             write_text(directory / "withdrawn", f"status=withdrawn\nrole={role or 'unknown'}\n")
#         say("The machine can be powered off.")
#     return plan["code"]
# 
# 
# def main(argv=None):
#     argv = list(sys.argv[1:] if argv is None else argv)
#     command = argv[0] if argv else "install"
#     rest = argv[1:] if argv else []
#     if command in ROLES:
#         return cmd_install([command, *rest], "install")
#     if command == "install":
#         return cmd_install(rest, "install")
#     if command == "flash":
#         return cmd_install(rest, "media")
#     if command == "fetch":
#         return cmd_fetch(rest)
#     if command == "remove":
#         return cmd_remove()
#     error = role_error(command)
#     if error and command != "":
#         return fail(error, 2)
#     return fail("Next: use install, flash, fetch, or remove. Nothing was written.", 2)
# 
# 
# if __name__ == "__main__":
#     try:
#         sys.exit(main())
#     except BrokenPipeError:
#         sys.exit(1)
# __DECIDE_END__
