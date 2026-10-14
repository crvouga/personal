#!/usr/bin/env python3
"""Decisions for adding or removing one fleet node.

The downloadable entry is this program. It does not clone a repository,
install Nix, or call GitHub's expiring Actions artifact API. Disk writes,
reboots, and runner calls go through replaceable commands.
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
import platform
import re
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

ROLES = ("ci", "web", "cache", "netboot", "devbox")
TRAN_RANK = {"nvme": 0, "sata": 1, "ata": 1, "sas": 2, "scsi": 2, "virtio": 3}
BUS_NAME = {
    "nvme": "NVMe",
    "sata": "SATA",
    "ata": "SATA",
    "sas": "SAS",
    "scsi": "SCSI",
    "virtio": "virtio",
    "usb": "USB",
}
# The release asset does not expire. The Fleet workflow's fleet-installer
# artifact still lasts 14 days; this program does not download that copy.
RELEASE_ISO = "https://github.com/crvouga/workspace/releases/download/fleet-installer/fleet-installer.iso"
DEVICE_RE = re.compile(r"^/dev/[A-Za-z0-9._/:-]+$")
WINDOWS_RE = re.compile(r"^\\\\\.\\PHYSICALDRIVE[0-9]+$")
TB = 1000 ** 4
GB = 1000 ** 3
SECTOR = 2048
# The shell initrd can mount these and honor findiso=. NTFS and APFS cannot.
SAFE_ISO_FS = frozenset({"ext2", "ext3", "ext4", "btrfs", "xfs", "vfat"})
# Win32_DiskDrive.BusType is a uint16. [string] on the live value is the digit.
WINDOWS_BUS = {
    "17": "nvme",
    "11": "sata",
    "7": "usb",
    "10": "sas",
    "3": "ata",
    "2": "ata",
    "1": "scsi",
}


# Every run writes a timestamped log. Secrets are redacted before they reach
# the screen or the file, so the log can be pasted anywhere.
LOG = {"path": None}
LOG_KEEP = 20
SECRET_RE = re.compile(
    r"AGE-SECRET-KEY-\S+"
    r"|\bhv[sbr]\.[A-Za-z0-9._-]+"
    r"|(?i:x-vault-token:)\s*\S+"
    r"|(?i:fleet\.enroll=|FLEET_ENROLL_TOKEN=)\S+"
    r"|--token(?:=|\s+)\S+"
)


def redact(text):
    return SECRET_RE.sub("[redacted]", str(text))


def _stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(message, level="INFO"):
    path = LOG["path"]
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as handle:
            for line in redact(message).splitlines() or [""]:
                handle.write(f"{_stamp()} {level} {line}\n")
    except OSError:
        pass


def start_log(argv):
    """Open this run's log. Falls back to the temp directory when the state
    directory is not writable. A missing log never stops the run."""
    stamp = _stamp().replace(":", "").replace("-", "")
    for base in (state_dir() / "logs", Path(tempfile.gettempdir()) / "fleet-node-logs"):
        try:
            base.mkdir(parents=True, exist_ok=True)
            path = base / f"fleet-node-{stamp}-{os.getpid()}.log"
            os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600))
        except OSError:
            continue
        LOG["path"] = str(path)
        for old in sorted(base.glob("fleet-node-*.log"))[:-LOG_KEEP]:
            try:
                old.unlink()
            except OSError:
                pass
        break
    log(f"fleet-node {' '.join(argv)}")
    log(f"os={current_os()} arch={machine_arch()} python={platform.python_version()} euid={effective_uid()} cwd={os.getcwd()}")
    knobs = sorted(f"{k}={v}" for k, v in os.environ.items() if k.startswith("FLEET_"))
    log("env " + " ".join(knobs) if knobs else "env (no FLEET_ variables)")


class Invariant(Exception):
    """A fact this program relies on is false, so continuing could corrupt a
    disk or a state file. Raised, never swallowed: only main() catches it, logs
    it, and stops with exit code 71 and the fix."""

    def __init__(self, what, fix, context):
        super().__init__(what)
        self.what = what
        self.fix = fix
        self.context = context


def invariant(condition, what, fix="Run `fleet-node doctor` and read the log; do not retry blindly.", **context):
    """Always-on assertion (unlike `assert`, `python -O` cannot remove it). It
    states a fact, names the thing that broke, carries the values that make the
    failure diagnosable, and says what to do about it."""
    if condition:
        return
    raise Invariant(what, fix, {key: redact(repr(value)) for key, value in sorted(context.items())})


def say(message):
    print(redact(message), file=sys.stderr)
    log(message)
    sink = LOG.get("sink")
    if sink:
        sink(redact(message))


def fail(message, code=1):
    say(message)
    if LOG["path"]:
        print(f"Log: {LOG['path']}", file=sys.stderr)
    return code


def run_logged(command, **kwargs):
    """subprocess.run that records the command, its exit code, and the tail of
    anything it printed."""
    log("run " + " ".join(str(part) for part in command))
    started = datetime.datetime.now()
    completed = subprocess.run(command, check=False, **kwargs)
    seconds = (datetime.datetime.now() - started).total_seconds()
    log(f"exit {completed.returncode} after {seconds:.1f}s")
    for stream in (completed.stdout, completed.stderr):
        if isinstance(stream, str) and stream.strip():
            log("output " + stream.strip()[-800:])
    return completed


def flag(value):
    if value is True:
        return True
    if value in (False, None, "", 0, "0"):
        return False
    if isinstance(value, str) and value.strip().lower() in ("false", "no"):
        return False
    try:
        return int(value) != 0
    except (TypeError, ValueError):
        return bool(value)


def size_label(size):
    try:
        number = int(size)
    except (TypeError, ValueError):
        return "0 bytes"
    if number >= TB:
        whole, rem = divmod(number, TB)
        return f"{whole}.{rem // (TB // 10)} TB"
    if number >= GB:
        whole, rem = divmod(number, GB)
        return f"{whole}.{rem // (GB // 10)} GB"
    return f"{number} bytes"


def plain_name(disk):
    model = (disk.get("model") or "disk").strip() or "disk"
    size = size_label(disk.get("size") or 0)
    if disk.get("usb") or disk.get("rm"):
        return f"USB disk, {size}, {model}"
    bus = BUS_NAME.get(disk.get("tran") or "", "disk")
    return f"internal {bus}, {size}, {model}"


def disk_id(disk):
    serial = re.sub(r"\s+", "", str(disk.get("serial") or "")).lower()
    if serial:
        basis = serial
    else:
        basis = "|".join([
            str(disk.get("model") or ""),
            str(disk.get("size") or ""),
            str(disk.get("tran") or ""),
        ])
    return hashlib.sha256(basis.encode()).hexdigest()[:16]


def device_ok(path):
    return bool(DEVICE_RE.fullmatch(path or "") or WINDOWS_RE.fullmatch(path or ""))


def mounted_tree(device):
    points = device.get("mountpoints") or []
    if any(point for point in points):
        return True
    return any(mounted_tree(child) for child in device.get("children") or [])


def parse_lsblk(raw):
    data = json.loads(raw)
    disks = []
    for device in data.get("blockdevices") or []:
        if device.get("type") != "disk":
            continue
        tran = str(device.get("tran") or "").lower()
        usb = tran == "usb"
        disks.append({
            "path": str(device.get("path") or ""),
            "tran": tran,
            "rm": flag(device.get("rm")),
            "hotplug": flag(device.get("hotplug")) or usb,
            "usb": usb,
            "internal": tran in TRAN_RANK and not usb,
            "mounted": mounted_tree(device),
            "whole": True,
            "size": device.get("size") or 0,
            "model": str(device.get("model") or "").strip(),
            "serial": str(device.get("serial") or "").strip(),
        })
    return disks


def _info_map(text):
    fields = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip().lower()] = value.strip()
    return fields


def _yes(fields, key):
    return fields.get(key, "").lower().startswith("y")


def _removable_phrase(value):
    """diskutil prints Yes/No in fixtures and Fixed/Removable on a live Mac."""
    text = str(value or "").strip().lower()
    return text in {"yes", "true", "removable"} or text.startswith("y")


def _mounted_phrase(value):
    """Yes is mounted. No and 'Not applicable (no file system)' are not."""
    text = str(value or "").strip().lower()
    if not text or text.startswith("n"):
        return False
    return text.startswith("y") or text == "mounted" or text == "true"


def parse_diskutil_info(text):
    fields = _info_map(text)
    protocol_l = fields.get("protocol", "").lower()
    location = fields.get("device location", "").lower()
    virtual = _yes(fields, "virtual")
    internal = _yes(fields, "internal") or location == "internal"
    removable = _removable_phrase(fields.get("removable media", ""))
    # Apple silicon diskutil names the internal SSD "Apple Fabric", not PCI-Express.
    usb = "usb" in protocol_l or (removable and not internal)
    hotplug = usb or _yes(fields, "hotplug") or location in ("external", "hotplug")
    if "nvme" in protocol_l or "pci" in protocol_l or "apple fabric" in protocol_l:
        tran = "nvme"
    elif "sata" in protocol_l or "ata" in protocol_l:
        tran = "sata"
    elif usb:
        tran = "usb"
    elif "sas" in protocol_l:
        tran = "sas"
    elif "scsi" in protocol_l or "virtio" in protocol_l:
        tran = "scsi"
    else:
        tran = "other"
    size = 0
    match = re.search(r"\((\d+) Bytes\)", fields.get("disk size", ""))
    if match:
        size = int(match.group(1))
    path = fields.get("device node", "")
    return {
        "path": path,
        "tran": tran,
        "rm": removable or usb,
        "hotplug": hotplug,
        "usb": usb,
        "internal": internal and not usb and not virtual,
        "mounted": _mounted_phrase(fields.get("mounted", "")),
        "whole": _yes(fields, "whole") or not fields.get("whole"),
        "size": size,
        "model": fields.get("device / media name", "").strip(),
        "serial": fields.get("serial number", "").strip(),
        "virtual": virtual,
    }


def _windows_mounted(device):
    """Mounted means a logical volume is attached. A boolean is not the query."""
    volumes = device.get("Volumes", None)
    if volumes is None:
        volumes = device.get("volumes")
    if isinstance(volumes, str):
        return bool(volumes.strip())
    if isinstance(volumes, (list, tuple)):
        return any(str(item or "").strip() for item in volumes)
    return False


def parse_windows(raw):
    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    disks = []
    for device in data:
        interface = str(device.get("InterfaceType") or "")
        bus_value = device.get("BusType")
        if bus_value is None or str(bus_value).strip() == "":
            bus = interface.strip()
        else:
            bus = str(bus_value).strip()
        media = str(device.get("MediaType") or "")
        pnp = str(device.get("PNPDeviceID") or "")
        bus_l = bus.lower()
        coded = WINDOWS_BUS.get(bus_l)
        usb = coded == "usb" or "usb" in bus_l or "usb" in pnp.lower() or "removable" in media.lower()
        if coded and coded != "usb":
            tran = coded
        elif "nvme" in bus_l:
            tran = "nvme"
        elif "sata" in bus_l or "ata" in bus_l or "ide" in bus_l:
            tran = "sata"
        elif "sas" in bus_l:
            tran = "sas"
        elif usb:
            tran = "usb"
        elif "scsi" in bus_l:
            tran = "scsi"
        else:
            tran = "other"
        path = str(device.get("DeviceID") or "")
        disks.append({
            "path": path,
            "tran": tran,
            "rm": usb or "removable" in media.lower(),
            "hotplug": usb or flag(device.get("Hotplug")),
            "usb": usb,
            "internal": not usb and tran in TRAN_RANK and "removable" not in media.lower(),
            "mounted": _windows_mounted(device),
            "whole": True,
            "size": device.get("Size") or 0,
            "model": str(device.get("Model") or "").strip(),
            "serial": str(device.get("SerialNumber") or "").strip(),
        })
    return disks


def _run(command):
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(detail or f"{command[0]} failed")
    return completed.stdout


def collect(os_name):
    # Test seam with no shell stubs, so it works on every OS: a JSON list of
    # disks in the parsed shape. It replaces the OS query entirely.
    canned = os.environ.get("FLEET_DISKS_FILE")
    if canned:
        return json.loads(Path(canned).read_text(encoding="utf-8"))
    if os_name == "Linux":
        tool = os.environ.get("FLEET_LSBLK", "lsblk")
        raw = _run([
            tool, "--json", "--bytes", "--paths", "--output",
            "PATH,TYPE,TRAN,RM,HOTPLUG,SIZE,MODEL,SERIAL,MOUNTPOINTS",
        ])
        return parse_lsblk(raw)
    if os_name == "Darwin":
        tool = os.environ.get("FLEET_DISKUTIL", "diskutil")
        listing = _run([tool, "list"])
        nodes = re.findall(r"^(/dev/disk[0-9]+)\b", listing, re.M)
        disks = []
        for node in nodes:
            info = _run([tool, "info", node])
            parsed = parse_diskutil_info(info)
            if parsed.get("virtual"):
                continue
            if not parsed["path"]:
                parsed["path"] = node
            disks.append(parsed)
        return disks
    if os_name == "Windows":
        tool = os.environ.get("FLEET_POWERSHELL") or shutil.which("powershell.exe") or "powershell"
        script = (
            "$ErrorActionPreference = 'Stop'; "
            "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); "
            "$rows = Get-CimInstance Win32_DiskDrive | ForEach-Object { "
            "$parts = @($_ | Get-CimAssociatedInstance -ResultClassName Win32_DiskPartition); "
            "$letters = @(); "
            "foreach ($part in $parts) { "
            "$vols = @($part | Get-CimAssociatedInstance -ResultClassName Win32_LogicalDisk); "
            "foreach ($vol in $vols) { if ($vol.DeviceID) { $letters += [string]$vol.DeviceID } } "
            "}; "
            "[PSCustomObject]@{ DeviceID=$_.DeviceID; Model=$_.Model; Size=[int64]$_.Size; "
            "InterfaceType=[string]$_.InterfaceType; BusType=[string]$_.BusType; "
            "MediaType=[string]$_.MediaType; PNPDeviceID=$_.PNPDeviceID; "
            "SerialNumber=$_.SerialNumber; Volumes=$letters } }; "
            "$rows | ConvertTo-Json -Compress -Depth 4"
        )
        raw = _run([tool, "-NoProfile", "-Command", script])
        return parse_windows(raw)
    raise RuntimeError(f"unsupported operating system {os_name}")


def install_block(disk):
    if not disk.get("whole"):
        return "partition"
    if not device_ok(disk.get("path") or ""):
        return "path"
    if disk.get("usb") or disk.get("tran") == "usb":
        return "usb"
    if disk.get("rm"):
        return "removable"
    if disk.get("hotplug"):
        return "hotplug"
    # A mounted internal disk is not a reason to refuse. On Linux and Windows
    # the disk holding the running system is always mounted, and converting a
    # running machine is the point. The installer reboots into RAM before it
    # touches the disk. USB, removable and hotplug disks are refused above.
    if disk.get("tran") not in TRAN_RANK or not disk.get("internal"):
        return "external"
    return None


def media_block(disk):
    if not disk.get("whole"):
        return "partition"
    if not device_ok(disk.get("path") or ""):
        return "path"
    if disk.get("internal") and not disk.get("usb") and not disk.get("rm"):
        return "internal"
    if disk.get("mounted"):
        return "mounted"
    if not (disk.get("usb") or disk.get("rm")):
        return "not-removable"
    return None


def plan_disks(disks, action):
    block = install_block if action == "install" else media_block
    eligible = []
    reasons = []
    for disk in disks:
        reason = block(disk)
        if reason is None:
            eligible.append(disk)
        else:
            reasons.append(reason)
    if len(eligible) == 1:
        chosen = eligible[0]
        invariant(block(chosen) is None, "plan_disks chose a disk its own rules refuse", disk=chosen)
        return {
            "ok": True,
            "plain": plain_name(chosen),
            "disk_id": disk_id(chosen),
            "path": chosen["path"],
            "disk": chosen,
        }
    if len(eligible) > 1:
        if action == "install":
            message = "Next: more than one internal disk was found. Disconnect the extra disk and run this program again. Nothing was written."
        else:
            message = "Next: more than one USB disk was found. Unplug the extra one and run this program again. Nothing was written."
        return {"ok": False, "next": message, "code": 2}
    if action == "install":
        if "hotplug" in reasons:
            message = "Next: the only disk is hotplug. Use the fixed internal disk and run this program again. Nothing was written."
        elif "removable" in reasons or "usb" in reasons:
            message = "Next: this program will not install a role onto a USB or removable disk. Connect the internal disk and run this program again. Nothing was written."
        elif "external" in reasons:
            message = "Next: no fixed internal disk was found. Connect that disk and run this program again. Nothing was written."
        else:
            message = "Next: no internal disk can be erased. Connect the internal disk and run this program again. Nothing was written."
    elif "internal" in reasons:
        message = "Next: refusing to write the installer onto an internal disk. Plug in one USB disk and run this program again. Nothing was written."
    elif "mounted" in reasons:
        message = "Next: the USB disk is mounted. Unmount it and run this program again. Nothing was written."
    else:
        message = "Next: no USB disk was found. Plug in one USB disk and run this program again. Nothing was written."
    return {"ok": False, "next": message, "code": 2}


def role_error(role):
    if role == "ci-gpu":
        return "Next: ci-gpu is not on the shared installer. Choose ci, web, cache, netboot, or devbox. Nothing was written."
    if role not in ROLES:
        return "Next: the role must be ci, web, cache, netboot, or devbox. Nothing was written."
    return None


def confirm(role, plain, answer, timed_out):
    if timed_out:
        return "Next: no answer arrived in time. Nothing was written. Run this program again and stay at the keyboard."
    if answer.strip() == "":
        return "Next: the confirmation was empty. Nothing was written. Run this program again and type the line this program shows."
    expected = f"{role}: {plain}"
    if answer.strip() != expected:
        return "Next: the confirmation did not match. Nothing was written. Run this program again and type the line exactly."
    return None


def removal_plan(busy, credential, withdrawn, role):
    """Never stop a running job. stop_job is always false."""
    if busy:
        if not credential:
            return {
                "action": "refuse",
                "code": 1,
                "stop_job": False,
                "power_off": False,
                "next": "Next: a job is running and this machine has no credential to withdraw itself. Leave the machine on.",
            }
        return {
            "action": "hold",
            "code": 0,
            "stop_job": False,
            "power_off": False,
            "next": "Next: a job is still running. This machine was not stopped. Leave it on and run this program again when the job has finished.",
        }
    if withdrawn:
        return {"action": "noop", "code": 0, "stop_job": False, "power_off": True, "next": ""}
    if role in ("web", "cache", "netboot", "devbox"):
        return {"action": "retire", "code": 0, "stop_job": False, "power_off": True, "next": ""}
    if not credential:
        return {
            "action": "refuse",
            "code": 1,
            "stop_job": False,
            "power_off": False,
            "next": "Next: no credential is on this machine, so this program did not withdraw it. Restore the runner key that is already kept on this machine, then run this program again.",
        }
    return {"action": "withdraw", "code": 0, "stop_job": False, "power_off": True, "next": ""}


def _host_is_windows():
    """Win32 CPython has no os.uname. Classify before calling it."""
    if os.name == "nt":
        return True
    platform = str(getattr(sys, "platform", "")).lower()
    return platform.startswith(("win", "cygwin", "msys", "mingw"))


def current_os():
    override = os.environ.get("FLEET_OS")
    if override:
        if override in ("Windows", "MINGW", "MSYS", "CYGWIN"):
            return "Windows"
        if override == "Darwin":
            return "Darwin"
        if override == "Linux":
            return "Linux"
        return override
    if _host_is_windows():
        return "Windows"
    uname = getattr(os, "uname", None)
    if uname is None:
        return "unknown"
    try:
        name = uname().sysname
    except AttributeError:
        return "unknown"
    if name.startswith(("MINGW", "MSYS", "CYGWIN")):
        return "Windows"
    return name


def state_dir():
    chosen = os.environ.get("FLEET_STATE")
    if chosen:
        return Path(chosen)
    nix = Path("/nix/fleet-state")
    if nix.is_dir():
        return nix
    return Path.home() / ".fleet"


def read_kv(path):
    data = {}
    file = Path(path)
    if not file.is_file():
        return data
    for line in file.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key == "target":
            data.setdefault("targets", []).append(value)
        else:
            data[key] = value
    return data


def marker_text(path):
    file = Path(path)
    if not file.is_file():
        return {}
    return read_kv(file)


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)
    invariant(path.read_text(encoding="utf-8") == text, "a state file does not read back as written", file=str(path))


MARKER_STATUS = {"installed": ("role", "status"), "withdrawn": ("status",)}


def checked_marker(directory, name):
    """Read a state marker, or {} when there is none. A marker that exists but
    is malformed is corruption: it decides whether a disk is wiped, so it is
    never guessed at."""
    path = Path(directory) / name
    if not path.is_file():
        return {}
    marker = marker_text(path)
    fix = f"Look at {path}. If this machine is meant to be reinstalled or rejoined, delete that file and run this program again."
    invariant(marker.get("status") == name, f"state marker {name} is malformed", fix, file=str(path), found=marker)
    for key in MARKER_STATUS[name]:
        invariant(key in marker, f"state marker {name} lacks {key}", fix, file=str(path), found=marker)
    if "role" in marker:
        invariant(marker["role"] in ROLES, f"state marker {name} names an unknown role", fix, file=str(path), role=marker["role"])
    return marker


def installed_for(role, directory):
    invariant(role in ROLES, "installed_for was asked about a role that does not exist", role=role)
    marker = checked_marker(directory, "installed")
    # A withdrawn runner can be recovered by a full reinstall, including back
    # into CI after a failed boot handoff. Its old marker is not a healthy node.
    withdrawn = checked_marker(directory, "withdrawn")
    return bool(marker) and marker["role"] == role and not withdrawn


def _read_line_timed(seconds):
    """Wait without select. Win32 raises OSError on console stdin."""
    holder = {}

    def _read():
        try:
            holder["line"] = sys.stdin.readline()
        except Exception as exc:
            holder["error"] = exc

    worker = threading.Thread(target=_read, daemon=True)
    worker.start()
    worker.join(seconds)
    if worker.is_alive():
        return "", True
    if "error" in holder:
        raise holder["error"]
    line = holder.get("line", "")
    if line == "":
        return "", False
    return line.rstrip("\n"), False


def read_answer(timeout):
    try:
        seconds = int(timeout)
    except (TypeError, ValueError):
        seconds = 120
    if seconds < 1:
        seconds = 1
    # FLEET_STDIN_WAIT=windows exercises this branch on hosts that are not Windows.
    if os.name == "nt" or os.environ.get("FLEET_STDIN_WAIT") == "windows":
        return _read_line_timed(seconds)
    try:
        ready, _, _ = select.select([sys.stdin], [], [], seconds)
    except OSError:
        return _read_line_timed(seconds)
    if not ready:
        return "", True
    line = sys.stdin.readline()
    if line == "":
        return "", False
    return line.rstrip("\n"), False


def installer_urls():
    iso = os.environ.get("FLEET_INSTALLER_URL") or RELEASE_ISO
    checksum = os.environ.get("FLEET_INSTALLER_SHA256_URL") or (iso + ".sha256")
    return iso, checksum


def curl_to(url, dest):
    tool = os.environ.get("FLEET_CURL", "curl")
    completed = run_logged(
        [tool, "-fsSL", "--retry", "3", "-o", str(dest), url],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        reason = (completed.stderr or "").strip().splitlines()
        raise RuntimeError(reason[-1] if reason else f"curl exited {completed.returncode}")
    return Path(dest).read_bytes()


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


ISO_MAGIC_OFFSET = 32769  # "CD001" at sector 16 of an ISO9660 volume


def looks_like_iso(blob):
    return len(blob) >= ISO_MAGIC_OFFSET + 5 and blob[ISO_MAGIC_OFFSET:ISO_MAGIC_OFFSET + 5] == b"CD001"


def fetch_installer(dest):
    """Copy the durable installer to dest. Leave dest untouched on failure."""
    dest = Path(dest)
    iso_url, sum_url = installer_urls()
    temporary = Path(tempfile.mkdtemp(prefix="fleet-fetch-"))
    try:
        body_path = temporary / "body"
        sum_path = temporary / "sum"
        try:
            body = curl_to(iso_url, body_path)
        except (OSError, RuntimeError) as exc:
            say(f"Why: {exc}")
            return fail("Next: the installer could not be downloaded. Check the network and run this program again. Nothing was written.")
        if not body or b"artifact has expired" in body.lower():
            return fail("Next: the installer download is missing or expired. Nothing was written. Run this program again after the durable installer is published.")
        try:
            checksum_body = curl_to(sum_url, sum_path)
        except (OSError, RuntimeError) as exc:
            say(f"Why: {exc}")
            return fail("Next: the installer checksum could not be downloaded. Nothing was written. Run this program again.")
        expected = checksum_body.decode("utf-8", "replace").split()
        if not expected or not re.fullmatch(r"[0-9a-fA-F]{64}", expected[0]):
            return fail("Next: the installer checksum was not valid. Nothing was written. Run this program again.")
        actual = file_sha256(body_path)
        if actual.lower() != expected[0].lower():
            return fail("Next: the installer download did not match its checksum. Nothing was written. Run this program again.")
        invariant(looks_like_iso(body), "the installer download matches its checksum but is not an ISO9660 image",
                  "The release asset is wrong. Re-run the Fleet workflow so it publishes a real fleet-installer.iso.",
                  size=len(body), head=body[:16])
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_file() and dest.read_bytes() == body:
            return 0
        staged = dest.with_suffix(dest.suffix + ".partial")
        staged.write_bytes(body)
        invariant(staged.stat().st_size == len(body), "the staged installer is the wrong size", staged=str(staged), want=len(body))
        os.replace(staged, dest)
        invariant(file_sha256(dest) == actual, "the installer on disk is not the bytes that were verified",
                  "The disk may be failing. Free space or use another drive, then run this program again.", file=str(dest))
        return 0
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def os_boot_tool(os_name):
    if os_name == "Darwin":
        return os.environ.get("FLEET_DARWIN_BOOT", "kexec")
    if os_name == "Windows":
        return os.environ.get("FLEET_WINDOWS_BOOT", "kexec")
    return os.environ.get("FLEET_KEXEC", "kexec")


def _le32(buf, offset):
    return int.from_bytes(buf[offset:offset + 4], "little")


def _susp_entries(blob):
    offset = 0
    while offset + 4 <= len(blob):
        length = blob[offset + 2]
        if length < 4 or offset + length > len(blob):
            break
        yield blob[offset:offset + 2], blob[offset:offset + length]
        offset += length


def _rock_ridge_name(system_use, handle):
    """Prefer the Rock Ridge name. A bad continuation falls back to the ISO name."""
    try:
        pending = system_use
        parts = []
        for _ in range(8):
            if not pending:
                break
            nxt = None
            for sig, entry in _susp_entries(pending):
                if sig == b"NM" and len(entry) >= 5 and not (entry[4] & 0x06):
                    parts.append(entry[5:])
                elif sig == b"CE" and len(entry) >= 28:
                    loc = _le32(entry, 4)
                    off = _le32(entry, 12)
                    length = _le32(entry, 20)
                    handle.seek(loc * SECTOR + off)
                    nxt = handle.read(length)
            pending = nxt
        if not parts:
            return None
        name = b"".join(parts).decode("utf-8", "strict")
    except (OSError, UnicodeError, ValueError):
        return None
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        return None
    return name


def _iso_name(ident):
    if ident == b"\x00":
        return "."
    if ident == b"\x01":
        return ".."
    text = ident.split(b";", 1)[0].decode("utf-8", "replace").rstrip(".")
    if not text or "/" in text or "\x00" in text:
        return None
    return text


def _record_name(record, handle):
    name_len = record[32]
    if 33 + name_len > len(record):
        return None
    su_off = 33 + name_len
    if su_off % 2:
        su_off += 1
    rock = _rock_ridge_name(record[su_off:], handle)
    if rock:
        return rock
    return _iso_name(record[33:33 + name_len])


def _directory_records(handle, extent, size):
    handle.seek(extent * SECTOR)
    data = handle.read(size)
    offset = 0
    while offset + 1 < len(data):
        if data[offset] == 0:
            offset = ((offset // SECTOR) + 1) * SECTOR
            continue
        length = data[offset]
        if length < 34 or offset + length > len(data):
            break
        yield data[offset:offset + length]
        offset += length


def _iso_index(handle):
    handle.seek(16 * SECTOR)
    pvd = handle.read(SECTOR)
    if len(pvd) < 190 or pvd[0] != 1 or pvd[1:6] != b"CD001":
        raise ValueError("not an ISO9660 installer")
    root_len = pvd[156]
    if root_len < 34 or 156 + root_len > len(pvd):
        raise ValueError("installer volume has no root directory")
    files = {}

    def walk(record, prefix):
        for child in _directory_records(handle, _le32(record, 2), _le32(record, 10)):
            name = _record_name(child, handle)
            if not name or name in (".", ".."):
                continue
            path = f"{prefix}/{name}" if prefix else name
            if child[25] & 0x02:
                walk(child, path)
            else:
                files[path] = (_le32(child, 2), _le32(child, 10))

    walk(pvd[156:156 + root_len], "")
    return files


def _iso_bytes(handle, files, path):
    key = path.lstrip("/")
    if key not in files:
        folded = {name.lower(): name for name in files}
        key = folded.get(key.lower())
    if key is None:
        raise ValueError(f"missing {path}")
    extent, size = files[key]
    if size <= 0 or size > 512 * 1024 * 1024:
        raise ValueError(f"unusable {path}")
    handle.seek(extent * SECTOR)
    body = handle.read(size)
    if len(body) != size:
        raise ValueError(f"short {path}")
    return body


def _boot_blocks(text):
    blocks = []
    current = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        head, _, rest = line.partition(" ")
        head = head.upper()
        if head == "LABEL":
            if current.get("linux") and current.get("initrd"):
                blocks.append(current)
            current = {"label": rest.strip()}
        elif head == "LINUX" and rest.strip():
            current["linux"] = rest.strip()
        elif head == "INITRD" and rest.strip():
            current["initrd"] = rest.strip()
        elif head == "APPEND":
            current["append"] = rest.strip()
    if current.get("linux") and current.get("initrd"):
        blocks.append(current)
    return blocks


def _choose_block(blocks, role):
    want = f"fleet.role={role}"
    matches = [block for block in blocks if want in block.get("append", "").split()]
    if not matches:
        raise ValueError(f"no {role} boot entry")
    preferred = "boot" if role == "ci" else f"boot-{role}"
    for block in matches:
        if block.get("label") == preferred:
            return block
    return sorted(matches, key=lambda block: (len(block.get("label", "")), block.get("label", "")))[0]


def iso_filesystem(path):
    override = os.environ.get("FLEET_ISO_FS")
    if override is not None and override.strip() != "":
        return override.strip().lower()
    tool = os.environ.get("FLEET_FINDMNT", "findmnt")
    if shutil.which(tool) is None and not os.path.isfile(tool):
        return ""
    completed = subprocess.run(
        [tool, "-n", "-o", "FSTYPE", "-T", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        return ""
    return completed.stdout.strip().splitlines()[0].strip().lower()


def extract_boot(iso_path, role):
    """Pull the role's kernel and initrd out of the installer ISO."""
    iso_path = Path(iso_path)
    with iso_path.open("rb") as handle:
        files = _iso_index(handle)
        config = _iso_bytes(handle, files, "isolinux/isolinux.cfg").decode("utf-8", "replace")
        block = _choose_block(_boot_blocks(config), role)
        kernel = _iso_bytes(handle, files, block["linux"])
        initrd = _iso_bytes(handle, files, block["initrd"])
    directory = iso_path.parent / "boot-files"
    directory.mkdir(parents=True, exist_ok=True)
    invariant(kernel and initrd, "the installer ISO holds an empty kernel or initrd", iso=str(iso_path), kernel=len(kernel), initrd=len(initrd))
    kernel_path = directory / "kernel"
    initrd_path = directory / "initrd"
    kernel_path.write_bytes(kernel)
    initrd_path.write_bytes(initrd)
    return str(kernel_path), str(initrd_path), block.get("append", "")


def _boot_command(append, role, iso_path, token=None, vault=None, ssh_key=None, findiso=True):
    tokens = append.split()
    if any(any(char.isspace() for char in token) for token in tokens):
        raise ValueError("boot command is not one line")
    extras = ["copytoram"]
    if findiso:
        iso_abs = str(Path(iso_path).resolve())
        if iso_abs == "" or any(char.isspace() for char in iso_abs):
            raise ValueError("installer path is not a single word")
        extras.append(f"findiso={iso_abs}")
    role_token = f"fleet.role={role}"
    if vault and any(char.isspace() for char in vault):
        raise ValueError("vault address is not a single word")
    kept = [t for t in tokens if t not in extras and t != role_token and not t.startswith(("fleet.enroll=", "fleet.vault=", "fleet.ssh=", "findiso="))]
    enroll = [f"fleet.enroll={token}"] if token else []
    where = [f"fleet.vault={vault}"] if token and vault else []
    invariant(role in ROLES, "refusing to build a boot command for an unknown role", role=role)
    access = ["fleet.ssh=" + base64.urlsafe_b64encode(validate_ssh_key(ssh_key).encode()).decode()] if ssh_key else []
    command = " ".join([*kept, *extras, *enroll, *where, *access, role_token])
    invariant(len(command.encode()) < 4096, "the installer boot command is too long", "Use an Ed25519 public key.", bytes=len(command.encode()))
    # The installer reads the LAST fleet.role=, so ours must be last.
    invariant(command.endswith(role_token) and command.rsplit("fleet.role=", 1)[1] == role,
              "the boot command must end with the chosen fleet.role=", command=command)
    invariant("\n" not in command and "\r" not in command, "the boot command spans lines", command=command)
    return command


def stage_reboot(os_name, role, iso, token=None, vault=None):
    """Load the ISO's own kernel. The shell initrd finds the file and copies it to RAM."""
    tool = os_boot_tool(os_name)
    flash = "Next: this computer cannot reboot into the installer. Nothing was written. Plug in one USB disk and run this program again with the word flash."
    if shutil.which(tool) is None and not os.path.isfile(tool):
        say(flash)
        return 1
    if iso_filesystem(iso) not in SAFE_ISO_FS:
        say(flash)
        return 1
    try:
        kernel, initrd, append = extract_boot(iso, role)
        cmdline = _boot_command(append, role, iso, token, vault, devbox_key() if role == "devbox" else None)
    except (OSError, ValueError):
        say("Next: the installer image could not be read. Nothing was written. Plug in one USB disk and run this program again with the word flash.")
        return 1
    for staged_file in (kernel, initrd, iso):
        invariant(os.path.isfile(staged_file) and os.path.getsize(staged_file) > 0, "a file the installer needs is missing or empty before reboot", file=str(staged_file))
    load = run_logged([tool, "--load", kernel, f"--initrd={initrd}", f"--command-line={cmdline}"])
    if load.returncode != 0:
        say(flash)
        return load.returncode or 1
    log("rebooting into the installer")
    execute = run_logged([tool, "-e"])
    if execute.returncode != 0:
        say(flash)
        return execute.returncode or 1
    return 0


# ---- Windows: convert this computer in place -------------------------------------
# Windows cannot kexec. Instead the installer image is written raw into a new
# partition carved out of C:, GRUB (taken from that same image) is placed on the
# EFI system partition with a config that boots the image's own kernel for the
# chosen role, and the firmware is told to boot it once. On reboot the installer
# erases the whole disk (Windows, the new partition and all) and installs NixOS.
# Everything before the reboot can be undone, and is, if a step fails.

LINUX_DATA_GUID = "{0fc63daf-8483-4772-8e79-3d69d8477de4}"
ESP_GUID = "{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}"
MIB = 1024 * 1024
WINDOWS_MARGIN = 64 * MIB
ESTIMATED_ISO = 8 * 1024 ** 3  # used for the early check when the release size is not known yet
ISO_SYSTEM_AREA = 16 * 2048  # the hybrid MBR; blank here so the partition holds one signature only
WRITE_CHUNK = 4 * MIB
WRITE_SECTOR = 4096
GUID_RE = re.compile(r"\{[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\}")
BOOT_LOADER_PARTS = ("EFI", "fleet", "grubx64.efi")
BOOT_LOADER_FIRMWARE_PATH = "\\" + "\\".join(BOOT_LOADER_PARTS)


def windows_disk_target(disk):
    """The device the installer image is written to. FLEET_WINDOWS_TARGET redirects
    the write to a plain file for tests; a device or a symlink is refused, so the
    redirect can never reach a real disk."""
    redirect = os.environ.get("FLEET_WINDOWS_TARGET")
    if redirect:
        try:
            mode = os.lstat(redirect).st_mode
        except OSError:
            mode = 0
        invariant(stat.S_ISREG(mode), "the test write target must be an existing regular file, never a device or symlink", path=redirect)
        return redirect
    return f"\\\\.\\PHYSICALDRIVE{disk}"


def windows_ps(script):
    tool = os.environ.get("FLEET_POWERSHELL") or shutil.which("powershell.exe") or "powershell"
    done = run_logged([tool, "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; " + script],
                      capture_output=True, text=True)
    invariant(done.returncode == 0, "a Windows disk command failed",
              "Nothing that cannot be undone was changed. Read the log, fix what it names, and run this program again.",
              command=script.strip().splitlines()[0][:120], code=done.returncode, error=(done.stderr or done.stdout or "").strip()[-300:])
    return done.stdout


def windows_facts():
    """One read-only query: the system disk, how far C: can shrink, the EFI system partition."""
    raw = windows_ps(
        "$letter = $env:SystemDrive.Substring(0, 1); "
        "$c = Get-Partition -DriveLetter $letter; "
        "$limit = Get-PartitionSupportedSize -DriveLetter $letter; "
        "$disk = Get-Disk -Number $c.DiskNumber; "
        f"$esp = Get-Partition -DiskNumber $c.DiskNumber | Where-Object {{ $_.GptType -eq '{ESP_GUID}' }} | Select-Object -First 1; "
        "$secure = $null; try { $secure = [bool](Confirm-SecureBootUEFI) } catch { }; "
        "$fw = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control').PEFirmwareType; "
        "[PSCustomObject]@{ Letter = $letter; DiskNumber = [int]$c.DiskNumber; PartitionNumber = [int]$c.PartitionNumber; "
        "Size = [int64]$c.Size; SizeMin = [int64]$limit.SizeMin; SizeMax = [int64]$limit.SizeMax; Style = [string]$disk.PartitionStyle; "
        "EspNumber = $(if ($esp) { [int]$esp.PartitionNumber } else { $null }); SecureBoot = $secure; Firmware = [int]$fw } | ConvertTo-Json -Compress")
    facts = json.loads(raw)
    invariant(isinstance(facts, dict) and "DiskNumber" in facts, "Windows described its system disk in an unexpected way", output=raw[-200:])
    return facts


def padded_size(size):
    return (size + WRITE_SECTOR - 1) // WRITE_SECTOR * WRITE_SECTOR


def windows_need(iso_size):
    return (padded_size(iso_size) + WINDOWS_MARGIN + MIB - 1) // MIB * MIB


def windows_findings(iso_size, disk_path=None, strict=True):
    """Everything about this Windows installation that decides whether it can convert itself.
    strict=False is the wizard's review, which is not elevated: Windows may refuse its
    storage queries there, and the elevated helper repeats this check with strict=True."""
    found = []
    bcdedit = os.environ.get("FLEET_BCDEDIT", "bcdedit")
    if shutil.which(bcdedit) or os.path.isfile(bcdedit):
        found.append(finding("boot-tool", "ok", "bcdedit"))
    else:
        found.append(finding("boot-tool", "fail", "bcdedit is not available", "Run this program from an administrator account on Windows, or make an install USB with the word flash."))
        return found
    try:
        facts = windows_facts()
    except (Invariant, OSError, ValueError) as exc:
        if not strict:
            found.append(finding("windows", "info", "the disk, firmware and Secure Boot checks run once you accept the administrator prompt"))
            return found
        found.append(finding("windows", "fail", f"Windows could not describe its system disk ({getattr(exc, 'what', exc)})",
                             "Run this program as administrator. If it repeats, make an install USB with the word flash."))
        return found
    if facts.get("Firmware") == 2:
        found.append(finding("firmware", "ok", "booted in UEFI mode"))
    else:
        found.append(finding("firmware", "fail", "Windows is booted in legacy BIOS mode",
                             "Convert the disk to GPT and enable UEFI in the firmware settings, or make an install USB with the word flash."))
    secure = facts.get("SecureBoot")
    if secure is True:
        found.append(finding("secure-boot", "fail", "Secure Boot is on and the installer is not signed",
                             "Turn Secure Boot off once: run `shutdown /r /fw`, open the Boot or Security page, set Secure Boot to Disabled, save, start Windows, and run this program again."))
    elif secure is None:
        found.append(finding("secure-boot", "warn", "Secure Boot state could not be read", "If the installer does not start, turn Secure Boot off in the firmware settings."))
    else:
        found.append(finding("secure-boot", "ok", "off"))
    if facts.get("Style") == "GPT":
        found.append(finding("partition-style", "ok", "GPT"))
    else:
        found.append(finding("partition-style", "fail", f"the system disk uses {facts.get('Style')} partitions", "Only GPT/UEFI disks convert in place. Make an install USB with the word flash."))
    if disk_path is not None:
        wanted = f"\\\\.\\PHYSICALDRIVE{facts.get('DiskNumber')}"
        if disk_path.upper() == wanted.upper():
            found.append(finding("system-disk", "ok", "the disk that would be erased holds Windows"))
        else:
            found.append(finding("system-disk", "fail", f"Windows runs from disk {facts.get('DiskNumber')}, not {disk_path}",
                                 "Disconnect the other internal disks, or make an install USB with the word flash."))
    if facts.get("EspNumber") is None:
        found.append(finding("efi-partition", "fail", "no EFI system partition on the system disk", "Make an install USB with the word flash."))
    else:
        found.append(finding("efi-partition", "ok", f"partition {facts['EspNumber']}"))
    need = windows_need(iso_size or ESTIMATED_ISO)
    room = int(facts.get("Size") or 0) - int(facts.get("SizeMin") or 0)
    if room >= need:
        found.append(finding("shrink", "ok", f"{facts['Letter']}: can give up {room // 1024 ** 3} GiB, the installer needs {need // MIB} MiB"))
    else:
        found.append(finding("shrink", "fail", f"{facts['Letter']}: can only shrink by {max(room, 0) // MIB} MiB, the installer needs {need // MIB} MiB",
                             f"Free space on {facts['Letter']}: (empty the Recycle Bin, remove large files, turn off hibernation with `powercfg /h off`), then run this program again."))
    return found


def write_region(iso, target, offset, zero_head=0, on_progress=None):
    """Write the image at a byte offset of a disk (or any file in tests), sync,
    read it back, and prove the bytes match. The first zero_head bytes are
    written as zeros: an ISO's hybrid MBR would otherwise make the partition
    look like both a filesystem and a partition table."""
    size = os.path.getsize(iso)
    invariant(offset % WRITE_SECTOR == 0, "the write offset is not sector aligned", offset=offset)
    fd = os.open(target, os.O_RDWR | getattr(os, "O_BINARY", 0))
    written = 0
    expected = hashlib.sha256()
    try:
        os.lseek(fd, offset, os.SEEK_SET)
        with open(iso, "rb") as source:
            while written < size:
                block = source.read(WRITE_CHUNK)
                invariant(block != b"", "the image ended early while writing", wrote=written, want=size)
                if written < zero_head:
                    cut = min(zero_head - written, len(block))
                    block = bytes(cut) + block[cut:]
                expected.update(block)
                if len(block) % WRITE_SECTOR:
                    block = block + b"\0" * (padded_size(len(block)) - len(block))
                count = os.write(fd, block)
                invariant(count == len(block), "the disk accepted a short write", wrote=count, asked=len(block), at=written)
                written += min(len(block), size - written)
                if on_progress:
                    on_progress(written, size)
        os.fsync(fd)
        os.lseek(fd, offset, os.SEEK_SET)
        seen, remaining = hashlib.sha256(), size
        while remaining:
            block = os.read(fd, min(WRITE_CHUNK, padded_size(remaining)))
            invariant(len(block) > 0, "the disk returned nothing while reading back", missing=remaining)
            take = min(len(block), remaining)
            seen.update(block[:take])
            remaining -= take
    finally:
        os.close(fd)
    invariant(seen.digest() == expected.digest(), "the partition does not hold the installer after writing",
              "The disk may be failing. Nothing that cannot be undone was changed; run this program again or make an install USB.")
    return size


def grub_config(role, linux_path, initrd_path, cmdline):
    invariant(role in ROLES, "refusing to write a boot config for an unknown role", role=role)
    for word in (linux_path, initrd_path, cmdline):
        invariant("\n" not in word and "\r" not in word and "'" not in word, "the boot config would span lines or quote badly", value=word[:80])
    return (
        "set timeout=3\n"
        "set default=0\n"
        "search --no-floppy --set=root --file /EFI/nixos-installer-image\n"
        f"menuentry 'Fleet installer: ERASES the internal disk and installs {role}' {{\n"
        f"    linux {linux_path} {cmdline}\n"
        f"    initrd {initrd_path}\n"
        "}\n"
    )


def iso_boot_material(iso_path, role):
    """The role's boot entry and GRUB program, read out of the installer image."""
    with Path(iso_path).open("rb") as handle:
        files = _iso_index(handle)
        config = _iso_bytes(handle, files, "isolinux/isolinux.cfg").decode("utf-8", "replace")
        block = _choose_block(_boot_blocks(config), role)
        grub = _iso_bytes(handle, files, "EFI/BOOT/BOOTX64.EFI")
    return block["linux"], block["initrd"], block.get("append", ""), grub


class WindowsUndo:
    """Steps to take back if a later step fails. Run newest first."""

    def __init__(self):
        self.steps = []

    def add(self, what, action):
        self.steps.append((what, action))

    def run(self):
        for what, action in reversed(self.steps):
            try:
                action()
                log(f"undo ok: {what}")
            except Exception as exc:  # best effort: report every step, stop on none
                log(f"undo FAILED: {what}: {exc}", "ERROR")
                say(f"Could not undo: {what}. See the log; Windows disk tools can finish it.")
        self.steps = []


def bcd(*args):
    tool = os.environ.get("FLEET_BCDEDIT", "bcdedit")
    done = run_logged([tool, *args], capture_output=True, text=True)
    invariant(done.returncode == 0, "bcdedit refused a firmware boot entry change", "Windows was not changed beyond what was undone. Make an install USB with the word flash.",
              args=" ".join(args), code=done.returncode, error=(done.stdout or done.stderr or "").strip()[-200:])
    return done.stdout


def stage_windows(role, iso, token=None, vault=None, chosen=None, on_progress=None, writer=None):
    """Carve a partition out of C:, put the installer in it, and arrange one boot
    into it. Returns 0 once the restart is scheduled; anything else changed nothing."""
    writer = writer or write_region
    invariant(role in ROLES, "refusing to stage an unknown role", role=role)
    iso_size = os.path.getsize(iso)
    findings = windows_findings(iso_size, chosen["path"] if chosen else None)
    problems = [item for item in findings if item["status"] == "fail"]
    if problems:
        say("Next: " + problems[0]["fix"] + " Nothing was written.")
        return 2
    facts = windows_facts()
    linux_path, initrd_path, append, grub = iso_boot_material(iso, role)
    cmdline = _boot_command(append, role, iso, token, vault, devbox_key() if role == "devbox" else None, findiso=False)
    config = grub_config(role, linux_path, initrd_path, cmdline)
    disk, need = int(facts["DiskNumber"]), windows_need(iso_size)
    undo = WindowsUndo()
    try:
        say(f"Making room: shrinking {facts['Letter']}: by {need // MIB} MiB.")
        windows_ps(f"Resize-Partition -DriveLetter {facts['Letter']} -Size {int(facts['Size']) - need}")
        undo.add(f"give {facts['Letter']}: its space back", lambda: windows_ps(
            f"$m = Get-PartitionSupportedSize -DriveLetter {facts['Letter']}; Resize-Partition -DriveLetter {facts['Letter']} -Size $m.SizeMax"))
        created = json.loads(windows_ps(
            f"$p = New-Partition -DiskNumber {disk} -Size {padded_size(iso_size)} -GptType '{LINUX_DATA_GUID}'; "
            "[PSCustomObject]@{ Number = [int]$p.PartitionNumber; Offset = [int64]$p.Offset; Size = [int64]$p.Size } | ConvertTo-Json -Compress"))
        undo.add("remove the installer partition", lambda: windows_ps(f"Remove-Partition -DiskNumber {disk} -PartitionNumber {created['Number']} -Confirm:$false"))
        invariant(created["Size"] >= padded_size(iso_size) and created["Offset"] % WRITE_SECTOR == 0,
                  "Windows made a partition that cannot hold the installer", created=created)
        say("Writing the installer into the new partition and reading it back.")
        writer(iso, windows_disk_target(disk), int(created["Offset"]), ISO_SYSTEM_AREA, on_progress)
        say("Placing the boot loader on the EFI system partition.")
        esp = Path(windows_ps(
            "$letter = 'ZYXWVUTSRQP'.ToCharArray() | Where-Object { -not (Test-Path ($_ + ':\\')) } | Select-Object -First 1; "
            "mountvol ($letter + ':') /S; if ($LASTEXITCODE -ne 0) { throw 'mountvol failed' }; ($letter + ':\\')").strip())
        undo.add("unmount the EFI system partition", lambda: windows_ps(f"mountvol {str(esp).rstrip(chr(92))} /D"))
        loader = esp.joinpath(*BOOT_LOADER_PARTS)
        loader.parent.mkdir(parents=True, exist_ok=True)
        undo.add("remove the boot loader", lambda: shutil.rmtree(loader.parent, ignore_errors=True))
        loader.write_bytes(grub)
        cfg = esp / "EFI" / "BOOT" / "grub.cfg"
        cfg.parent.mkdir(parents=True, exist_ok=True)
        saved = cfg.read_bytes() if cfg.is_file() else None
        cfg.write_text(config, encoding="utf-8", newline="\n")
        undo.add("restore the boot config", (lambda: cfg.write_bytes(saved)) if saved is not None else (lambda: cfg.unlink()))
        invariant(cfg.read_text(encoding="utf-8") == config and loader.read_bytes() == grub, "the EFI system partition did not keep the boot loader")
        say("Telling the firmware to start the installer once.")
        copied = GUID_RE.search(bcd("/copy", "{bootmgr}", "/d", "Fleet installer"))
        invariant(copied is not None, "bcdedit gave no id for the new boot entry")
        entry = copied.group(0)
        undo.add("delete the firmware boot entry", lambda: bcd("/delete", entry))
        bcd("/set", entry, "path", BOOT_LOADER_FIRMWARE_PATH)
        bcd("/set", "{fwbootmgr}", "displayorder", entry, "/addfirst")
        bcd("/set", "{fwbootmgr}", "bootsequence", entry)
        shown = bcd("/enum", "{fwbootmgr}")
        invariant(re.search(r"bootsequence\s+" + re.escape(entry), shown, re.I) is not None,
                  "the firmware did not accept the one-time boot entry", "Windows was left as it was. Make an install USB with the word flash.", entry=entry)
        shutdown = os.environ.get("FLEET_SHUTDOWN", "shutdown")
        restart = run_logged([shutdown, "/r", "/t", "15", "/c", "Fleet installer: this computer will erase its disk and become a " + role + " node."], capture_output=True, text=True)
        invariant(restart.returncode == 0, "Windows would not schedule the restart", "Restart the computer by hand now; it will boot the installer once.", code=restart.returncode)
    except BaseException:
        undo.run()
        raise
    return 0


def write_media(os_name, iso, device):
    if not device_ok(device):
        say("Next: the USB disk path was not usable. Nothing was written. Run this program again.")
        return 1
    tool = os.environ.get("FLEET_DD", "dd")
    if os_name == "Darwin" and device.startswith("/dev/"):
        target = "/dev/r" + device[len("/dev/"):]
        block = "bs=4m"
    else:
        target = device
        block = "bs=4M"
    completed = run_logged([tool, f"if={iso}", f"of={target}", block], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if completed.returncode != 0:
        say("Next: the USB disk could not be written. Nothing else was written. Run this program again from an administrator account.")
        return 1
    return 0


def load_role(argv_role):
    if argv_role:
        return argv_role.strip()
    say("Type the role (ci, web, cache, netboot, or devbox):")
    answer, timed_out = read_answer(os.environ.get("FLEET_CONFIRM_TIMEOUT", "120"))
    if timed_out or answer.strip() == "":
        say("Next: the role was not given. Nothing was written. Run this program again and type ci, web, cache, netboot, or devbox.")
        return None
    return answer.strip()


def choose_disk(os_name, action):
    try:
        disks = collect(os_name)
    except (OSError, RuntimeError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        return {"ok": False, "code": 2, "next": f"Next: the disks could not be listed ({exc}). Nothing was written. Run this program again."}
    return plan_disks(disks, action)


def cmd_fetch(argv):
    if len(argv) != 1:
        return fail("Next: give the file name where the installer should be saved. Nothing was written.", 2)
    return fetch_installer(argv[0])


VAULT_DEFAULT = "https://vault.chrisvouga.dev"
GUIDE_URL = "https://raw.githubusercontent.com/crvouga/workspace/main/packages/fleet/docs/agent-install.md"
X86 = ("x86_64", "amd64", "x64")
GIB = 1024 ** 3
MARK = {"ok": "ok  ", "info": "info", "warn": "WARN", "fail": "FAIL"}


def machine_arch():
    return (os.environ.get("FLEET_ARCH") or platform.machine() or "unknown").lower()


def effective_uid():
    override = os.environ.get("FLEET_EUID")
    if override not in (None, ""):
        try:
            return int(override)
        except ValueError:
            return None
    geteuid = getattr(os, "geteuid", None)
    return geteuid() if geteuid else None


def vault_addr():
    return (os.environ.get("FLEET_VAULT_ADDR") or VAULT_DEFAULT).rstrip("/")


def finding(name, status, detail, fix=""):
    return {"name": name, "status": status, "detail": detail, "fix": fix}


def mem_total(os_name):
    if os_name == "Linux":
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) * 1024
        except (OSError, ValueError, IndexError):
            return None
    if os_name == "Darwin":
        try:
            return int(_run(["sysctl", "-n", "hw.memsize"]).strip())
        except (OSError, RuntimeError, ValueError):
            return None
    if os_name == "Windows":
        tool = os.environ.get("FLEET_POWERSHELL") or shutil.which("powershell.exe") or "powershell"
        try:
            return int(_run([tool, "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"]).strip())
        except (OSError, RuntimeError, ValueError):
            return None
    return None


def _curl_reason(done):
    lines = (done.stderr or "").strip().splitlines()
    return lines[-1] if lines else f"curl exited {done.returncode}"


def probe_installer():
    """Ask for one byte of the installer. Returns (error, total size or None)."""
    iso_url, _ = installer_urls()
    tool = os.environ.get("FLEET_CURL", "curl")
    with tempfile.TemporaryDirectory(prefix="fleet-probe-") as scratch:
        headers = Path(scratch) / "headers"
        try:
            done = run_logged(
                [tool, "-fsSL", "--max-time", "30", "-r", "0-0", "-D", str(headers), "-o", os.devnull, iso_url],
                capture_output=True,
                text=True,
            )
        except OSError as exc:
            return f"curl could not run ({exc})", None
        if done.returncode != 0:
            return _curl_reason(done), None
        size = None
        if headers.is_file():
            for line in headers.read_text(errors="replace").splitlines():
                match = re.match(r"(?i)content-range:\s*bytes\s+\d+-\d+/(\d+)", line.strip())
                if match:
                    size = int(match.group(1))
        return None, size


def lookup_verdict(role, status, reason, data):
    """Turn Vault's answer to sys/wrapping/lookup into a finding. status is the
    HTTP status, or None when Vault could not be reached at all."""
    if status in (400, 403, 404):
        return finding("enrollment", "fail", "the token is spent, expired, or not a wrapping token",
                       f"Mint a new single-use token with: just enroll {role or '<role>'}")
    if status != 200:
        return finding("enrollment", "fail", f"Vault at {vault_addr()} did not answer ({reason})",
                       "Check this machine's network and that Vault is up, then run this program again.")
    if not isinstance(data, dict):
        return finding("enrollment", "fail", "Vault answered with something that is not JSON",
                       f"Check that {vault_addr()} is the Vault address, then run this program again.")
    path = str(data.get("creation_path") or "").rstrip("/")
    if role and not path.endswith(f"fleet/{role}"):
        return finding("enrollment", "fail", f"the token was minted for {path or 'something else'}, not the {role} key",
                       f"Mint a token for this role with: just enroll {role}")
    return finding("enrollment", "ok", f"token is valid for {role or path} and has not been used")


def lookup_token(token, role):
    """Check a wrapping token without spending it. Returns a finding."""
    tool = os.environ.get("FLEET_CURL", "curl")
    url = f"{vault_addr()}/v1/sys/wrapping/lookup"
    with tempfile.TemporaryDirectory(prefix="fleet-lookup-") as scratch:
        body = Path(scratch) / "body"
        fd = os.open(body, os.O_WRONLY | os.O_CREAT, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump({"token": token}, handle)
        reply = Path(scratch) / "reply"
        try:
            done = run_logged(
                [tool, "-fsS", "--max-time", "20", "-X", "POST", "-H", "Content-Type: application/json",
                 "--data-binary", f"@{body}", "-o", str(reply), url],
                capture_output=True,
                text=True,
            )
        except OSError as exc:
            return finding("enrollment", "fail", f"curl could not run ({exc})", "Install curl, then run this program again.")
        if done.returncode != 0:
            reason = _curl_reason(done)
            seen = re.search(r"error: (\d{3})", reason)
            return lookup_verdict(role, int(seen.group(1)) if seen else None, reason, None)
        try:
            data = json.loads(reply.read_text(encoding="utf-8")).get("data") or {}
        except (OSError, ValueError, AttributeError):
            data = None
    return lookup_verdict(role, 200, "", data)


# The wizard replaces these with versions that do not need curl.
NET = {}


def preflight(os_name, role, action, token, directory, need_root=True, ssh_key=None, auto_enroll=False, disk_path=None):
    """Everything that can be known before anything is erased. All problems are
    reported together so one fix pass is enough."""
    found = []
    uid = effective_uid()
    if not need_root:
        found.append(finding("privilege", "info", "the OS asks for permission when the install starts"))
    elif os_name in ("Linux", "Darwin") and uid is not None and uid != 0:
        found.append(finding("privilege", "fail", f"running as user id {uid}, not root", "Run this program again with sudo."))
    else:
        found.append(finding("privilege", "ok", "root" if uid == 0 else "administrator rights are checked by the OS"))
    if action == "install":
        previous = node_role(read_kv(os.environ.get("FLEET_NODE_CONF", "/etc/fleet/node.conf")))
        if previous == "ci" and job_busy(os.environ.get("FLEET_BUSY_DIR", "/run/fleet")):
            found.append(finding("runner-idle", "fail", "this CI node is running a job", "Wait for its jobs to finish, then check again. A role conversion never interrupts a running job."))
        if role == "devbox":
            try:
                validate_ssh_key(ssh_key if ssh_key is not None else devbox_key())
                found.append(finding("ssh-access", "ok", "public key for the dev account is valid"))
            except (Invariant, OSError) as exc:
                found.append(finding("ssh-access", "fail", str(exc), "Paste your SSH public key in the wizard, or set FLEET_DEVBOX_SSH_KEY_FILE to your .pub file. Never supply a private key."))
        arch = machine_arch()
        if arch in X86:
            found.append(finding("architecture", "ok", arch))
        else:
            found.append(finding("architecture", "fail", f"{arch}; the installer is x86_64 UEFI only",
                                 "Run this program on an x86_64 computer. Other architectures are not supported yet."))
        if os_name == "Linux":
            efi = Path(os.environ.get("FLEET_EFI_DIR") or "/sys/firmware/efi")
            if efi.is_dir():
                found.append(finding("firmware", "ok", "booted in UEFI mode"))
            else:
                found.append(finding("firmware", "fail", "booted in legacy BIOS mode",
                                     "Turn on UEFI boot (and turn off CSM or legacy boot) in the firmware settings, then run this program again."))
        if os_name != "Windows":
            tool = os_boot_tool(os_name)
            if shutil.which(tool) or os.path.isfile(tool):
                found.append(finding("boot-tool", "ok", tool))
            else:
                found.append(finding("boot-tool", "fail", f"{tool} is not installed",
                                     "This computer cannot reboot into the installer. Plug in one USB disk and run this program again with the word flash."))
            stage = iso_filesystem(directory)
            if stage in SAFE_ISO_FS:
                found.append(finding("staging", "ok", f"the installer is staged on {stage}"))
            else:
                found.append(finding("staging", "fail", f"the installer would be staged on {stage or 'an unknown filesystem'}",
                                     "This computer cannot reboot into the installer. Plug in one USB disk and run this program again with the word flash."))
    error, size = NET.get("probe", probe_installer)()
    if action == "install" and os_name == "Windows":
        found.extend(NET.get("windows", windows_findings)(size, disk_path, need_root))
    if error:
        found.append(finding("network", "fail", f"the installer cannot be downloaded ({error})",
                             "Check the network. If the release is missing, wait for the Fleet workflow to publish it on merge, then run this program again."))
    else:
        found.append(finding("network", "ok", "the installer release is reachable"))
        if size:
            free = shutil.disk_usage(directory).free if Path(directory).exists() else None
            if free is not None and free < size * 1.25:
                found.append(finding("space", "fail", f"{free // GIB} GiB free in {directory}, the installer needs about {size * 5 // 4 // GIB + 1} GiB",
                                     f"Free disk space in {directory}, then run this program again."))
            else:
                found.append(finding("space", "ok", f"installer is {size // (1024 ** 2)} MiB"))
            memory = mem_total(os_name) if action == "install" else None
            if memory is not None and memory < size * 1.5:
                found.append(finding("memory", "warn", f"{memory // GIB} GiB RAM; the installer is copied into RAM",
                                     "Add RAM if the install fails to boot."))
    if action == "install":
        if token:
            found.append(NET.get("lookup", lookup_token)(token, role))
        elif auto_enroll:
            found.append(finding("enrollment", "info", "the repository owner will be asked to approve this node on GitHub before anything is erased"))
        else:
            found.append(finding("enrollment", "warn", "no enrollment token; this node would generate a key no other node shares",
                                 f"Mint one with `just enroll {role or '<role>'}` and rerun with its line, unless this role has no encrypted secrets yet."))
    return found


def show_findings(found):
    say("Checks:")
    for item in found:
        say(f"  {MARK[item['status']]}  {item['name']:<13} {item['detail']}")
        if item["fix"] and item["status"] in ("warn", "fail"):
            say(f"        fix: {item['fix']}")


def next_for(item):
    fix = item["fix"].strip()
    return f"Next: {fix}" if "Nothing was written" in fix else f"Next: {fix} Nothing was written."


def cmd_doctor(argv):
    """Read-only. Says exactly what would be erased and whether anything stands in the way."""
    as_json = "--json" in argv
    argv = [a for a in argv if a != "--json"]
    argv, token, token_error = enroll_token(argv)
    if token_error:
        return fail(token_error, 2)
    os_name = current_os()
    if os_name not in ("Linux", "Darwin", "Windows"):
        return fail(f"Next: {os_name} cannot start this installer. Nothing was written.", 2)
    role = argv[0] if argv else None
    if role is not None:
        error = role_error(role)
        if error:
            return fail(error, 2)
    directory = state_dir()
    chosen = choose_disk(os_name, "install")
    found = preflight(os_name, role, "install", token, directory, auto_enroll=enroll_enabled() and role is not None,
                      disk_path=chosen["path"] if chosen["ok"] else None)
    if chosen["ok"]:
        found.append(finding("disk", "ok", chosen["plain"]))
    else:
        found.append(finding("disk", "fail", "no internal disk can be erased safely", chosen["next"].replace("Next: ", "", 1)))
    if role and installed_for(role, directory):
        found.append(finding("state", "info", f"already installed as {role}; running the program again does not wipe it"))
    problems = [item for item in found if item["status"] == "fail"]
    if as_json:
        print(json.dumps({
            "ok": not problems,
            "role": role,
            "erases": chosen.get("plain") if chosen["ok"] else None,
            "confirm": f"{role}: {chosen['plain']}" if role and chosen["ok"] else None,
            "checks": found,
            "log": LOG["path"],
        }, indent=2))
    else:
        show_findings(found)
        if chosen["ok"]:
            say(f"Would erase: {chosen['plain']}")
    if problems:
        say(f"Result: NOT ready, {len(problems)} problem{'s' if len(problems) != 1 else ''}.")
        return fail(next_for(problems[0]), 2)
    say("Result: ready. Nothing was written. Show the person the role and the disk, get their yes, then run again with --yes.")
    return 0


def cmd_status():
    """Read-only health of an installed node."""
    conf = os.environ.get("FLEET_NODE_CONF", "/etc/fleet/node.conf")
    role = node_role(read_kv(conf))
    if not role:
        return fail("Next: this machine is not an installed fleet node (no role in " + conf + "). Install it with fleet-node.sh ROLE.", 1)
    found = [finding("role", "ok", role)]
    try:
        host = os.environ.get("FLEET_HOSTNAME") or _run(["hostname"]).strip()
    except (OSError, RuntimeError):
        host = "unknown"
    found.append(finding("hostname", "ok", host))
    revision = Path(os.environ.get("FLEET_REVISION", "/etc/fleet/revision"))
    rev = revision.read_text().strip() if revision.is_file() else "unknown"
    if rev in ("", "unknown"):
        found.append(finding("revision", "fail", "unknown", "This build has no git revision. Wait for the next sync, then check again."))
    else:
        found.append(finding("revision", "ok", rev[:12]))
    if (state_dir() / "withdrawn").is_file():
        found.append(finding("membership", "fail", "withdrawn: this node was removed from the fleet", "Reinstall it with fleet-node.sh ROLE to rejoin."))
    health = Path(os.environ.get("FLEET_HEALTH_FAILURE", "/run/fleet/health-failure"))
    if health.is_file():
        found.append(finding("last-sync", "fail", "the last switch failed its health check and was rolled back: "
                             + " ".join(health.read_text(errors="replace").split())[:200],
                             "Fix the cause in git (a revert pull request). The node retries by itself."))
    systemctl = os.environ.get("FLEET_SYSTEMCTL", "systemctl")
    if shutil.which(systemctl) or os.path.isfile(systemctl):
        timer = run_logged([systemctl, "is-active", "fleet-sync.timer"], capture_output=True, text=True)
        state = (timer.stdout or "").strip() or "unknown"
        found.append(finding("sync-timer", "ok" if state == "active" else "fail", state,
                             "" if state == "active" else "The node is not polling main. Check `systemctl status fleet-sync.timer`."))
        failed = run_logged([systemctl, "--failed", "--no-legend", "--plain"], capture_output=True, text=True)
        units = [line.split()[0] for line in (failed.stdout or "").splitlines() if line.split()]
        if units:
            found.append(finding("units", "fail", "failed: " + ", ".join(units), "Read `journalctl -u " + units[0] + "` on the node."))
        else:
            found.append(finding("units", "ok", "no failed units"))
    else:
        found.append(finding("systemd", "warn", "systemctl is not available here", ""))
    install_log = state_dir() / "logs" / "install.log"
    if install_log.is_file():
        found.append(finding("install-log", "info", str(install_log)))
    show_findings(found)
    problems = [item for item in found if item["status"] == "fail"]
    if problems:
        say(f"Result: {len(problems)} problem{'s' if len(problems) != 1 else ''}.")
        return fail(f"Next: {problems[0]['fix'] or problems[0]['detail']}", 1)
    say("Result: healthy.")
    return 0


ENROLL_RE = re.compile(r"^[A-Za-z0-9._-]{8,512}$")

# ---- Self-service enrollment ---------------------------------------------------
# A new node has no credential for Vault, and the installer release is public, so
# a node cannot simply ask for its role key. The person who owns the repository
# approves the node instead: the node shows a prefilled GitHub issue, the owner
# submits it, and the `Fleet enroll` workflow (which logs in to Vault with its
# GitHub OIDC identity, never a stored secret) asks Vault for a single-use
# response-wrapped token and posts it as a comment sealed to the node's one-time
# public key. Only the node holds the matching private key, and the node alone
# can unwrap the token. Anyone else reading the comment sees ciphertext.

REPO = "crvouga/workspace"
ENROLL_WAIT = 15 * 60
ENROLL_POLL = 15
FIELD_ROLE = "fleet-enroll-role: "
FIELD_KEY = "fleet-enroll-key: "
P25519 = 2 ** 255 - 19
BASE_POINT = (9).to_bytes(32, "little")


def x25519(scalar, point):
    """RFC 7748 X25519, in plain Python so the one downloaded file needs no
    package. Checked against the RFC's test vectors in tests/test_enroll.py."""
    invariant(len(scalar) == 32 and len(point) == 32, "x25519 needs 32-byte inputs", scalar=len(scalar), point=len(point))
    k = bytearray(scalar)
    k[0] &= 248
    k[31] &= 127
    k[31] |= 64
    k = int.from_bytes(k, "little")
    x1 = int.from_bytes(point, "little") & ((1 << 255) - 1)
    x2, z2, x3, z3, swap = 1, 0, x1, 1, 0
    for t in reversed(range(255)):
        bit = (k >> t) & 1
        swap ^= bit
        if swap:
            x2, x3, z2, z3 = x3, x2, z3, z2
        swap = bit
        a, b = (x2 + z2) % P25519, (x2 - z2) % P25519
        aa, bb = a * a % P25519, b * b % P25519
        e = (aa - bb) % P25519
        c, d = (x3 + z3) % P25519, (x3 - z3) % P25519
        da, cb = d * a % P25519, c * b % P25519
        x3 = (da + cb) ** 2 % P25519
        z3 = x1 * (da - cb) ** 2 % P25519
        x2 = aa * bb % P25519
        z2 = e * (aa + 121665 * e) % P25519
    if swap:
        x2, x3, z2, z3 = x3, x2, z3, z2
    return (x2 * pow(z2, P25519 - 2, P25519) % P25519).to_bytes(32, "little")


def _hkdf(secret, salt, info, length):
    prk = hmac.new(salt, secret, hashlib.sha256).digest()
    out, block, counter = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


def _stream(key, length):
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:length])


def _b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def new_keypair():
    private = os.urandom(32)
    return private, x25519(private, BASE_POINT)


def seal(plaintext, recipient_public):
    """Encrypt to one public key: ephemeral X25519, HKDF-SHA256, an HMAC-SHA256
    keystream, and an HMAC-SHA256 tag over the ciphertext (encrypt-then-MAC)."""
    ephemeral = os.urandom(32)
    ephemeral_public = x25519(ephemeral, BASE_POINT)
    shared = x25519(ephemeral, recipient_public)
    invariant(shared != bytes(32), "the recipient public key is a low-order point")
    keys = _hkdf(shared, ephemeral_public + recipient_public, b"fleet-seal-v1", 64)
    cipher = bytes(a ^ b for a, b in zip(plaintext, _stream(keys[:32], len(plaintext))))
    tag = hmac.new(keys[32:], ephemeral_public + cipher, hashlib.sha256).digest()
    return _b64(ephemeral_public + cipher + tag)


def open_sealed(blob, private):
    """Returns the plaintext, or None when the blob is not for this key or was altered."""
    try:
        raw = _unb64(blob.strip())
    except ValueError:
        return None
    if len(raw) < 64:
        return None
    ephemeral_public, cipher, tag = raw[:32], raw[32:-32], raw[-32:]
    shared = x25519(private, ephemeral_public)
    if shared == bytes(32):
        return None
    public = x25519(private, BASE_POINT)
    keys = _hkdf(shared, ephemeral_public + public, b"fleet-seal-v1", 64)
    want = hmac.new(keys[32:], ephemeral_public + cipher, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, want):
        return None
    return bytes(a ^ b for a, b in zip(cipher, _stream(keys[:32], len(cipher))))


def enroll_issue_url(role, public):
    body = (
        f"Approve a new fleet {role} node. Submit this issue as it is.\n\n"
        f"{FIELD_ROLE}{role}\n{FIELD_KEY}{_b64(public)}\n"
    )
    query = urllib.parse.urlencode({"title": f"fleet-enroll {role}", "body": body}, quote_via=urllib.parse.quote)
    return f"https://github.com/{REPO}/issues/new?{query}"


def parse_enroll_request(title, body):
    """(role, public key bytes) from an enrollment issue, or raises Invariant."""
    fields = {}
    for line in str(body or "").splitlines():
        for name in (FIELD_ROLE, FIELD_KEY):
            if line.startswith(name):
                fields[name] = line[len(name):].strip()
    role = fields.get(FIELD_ROLE, "")
    invariant(role in ROLES, "the enrollment request names an unknown role", "Run the installer again.", role=role)
    invariant(str(title or "").strip() == f"fleet-enroll {role}", "the issue title does not match its role", title=title, role=role)
    try:
        public = _unb64(fields.get(FIELD_KEY, ""))
    except ValueError:
        public = b""
    invariant(len(public) == 32, "the enrollment request holds no valid public key", "Run the installer again.")
    return role, public


def _github(path, etag=None):
    base = os.environ.get("FLEET_GITHUB_API", "https://api.github.com").rstrip("/")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "fleet-node", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.environ.get("FLEET_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    if etag:
        headers["If-None-Match"] = etag
    try:
        with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=20) as reply:
            return reply.status, json.loads(reply.read().decode("utf-8", "replace")), reply.headers.get("ETag")
    except urllib.error.HTTPError as exc:
        return exc.code, None, etag
    except (urllib.error.URLError, OSError, ValueError):
        return 0, None, etag


def await_approval(role, private, public, wait=ENROLL_WAIT, interval=ENROLL_POLL, sleep=time.sleep, notify=None, cancel=None):
    """Poll the public issue until the workflow answers. Returns (token, error)."""
    marker = FIELD_KEY + _b64(public)
    issue, etags = None, {}
    deadline = time.monotonic() + wait
    while True:
        if issue is None:
            path = f"/repos/{REPO}/issues?state=all&sort=created&direction=desc&per_page=30"
            code, data, etags["issues"] = _github(path, etags.get("issues"))
            if code == 200:
                for item in data:
                    if "pull_request" not in item and marker in str(item.get("body") or ""):
                        issue = item["number"]
                        if notify:
                            notify("The request was received. Waiting for the approval workflow.")
                        break
        if issue is not None:
            code, data, etags["comments"] = _github(f"/repos/{REPO}/issues/{issue}/comments?per_page=50", etags.get("comments"))
            for comment in (data or []) if code == 200 else []:
                if (comment.get("user") or {}).get("login") != "github-actions[bot]":
                    continue
                for line in str(comment.get("body") or "").splitlines():
                    if line.startswith("fleet-error: "):
                        return None, line[len("fleet-error: "):].strip()
                    if line.startswith("fleet-sealed: "):
                        plain = open_sealed(line[len("fleet-sealed: "):], private)
                        if plain is None:
                            continue
                        try:
                            answer = json.loads(plain.decode("utf-8"))
                        except ValueError:
                            continue
                        if answer.get("role") == role and ENROLL_RE.fullmatch(str(answer.get("token") or "")):
                            return answer["token"], None
        if cancel and cancel():
            return None, "cancelled"
        if time.monotonic() >= deadline:
            return None, "nobody approved this node in time"
        sleep(interval)


def self_enroll(role, notify=None, wait=None, cancel=None):
    """Ask the owner to approve this node. Returns (token, error). Nothing is
    erased here; a refusal or a timeout leaves every disk as it was."""
    say_it = notify or say
    private, public = new_keypair()
    url = enroll_issue_url(role, public)
    say_it("Approve this node: press 'Submit new issue' on the GitHub page that opens, signed in as the repository owner.")
    say_it("If no page opened, open this address on any computer: " + url)
    if not os.environ.get("FLEET_NO_BROWSER"):
        try:
            webbrowser.open(url)
        except webbrowser.Error:
            pass
    seconds = wait if wait is not None else int(os.environ.get("FLEET_ENROLL_WAIT") or ENROLL_WAIT)
    interval = int(os.environ.get("FLEET_ENROLL_POLL") or ENROLL_POLL)
    token, error = await_approval(role, private, public, seconds, interval, notify=notify, cancel=cancel)
    if token:
        say_it("Approved. The enrollment token arrived sealed and was opened on this machine.")
    return token, error


def enroll_enabled():
    return not flag(os.environ.get("FLEET_NO_ENROLL"))




def validate_ssh_key(value):
    """No authorized_keys options or line injection. Validate the wire type.
    The live installer additionally asks ssh-keygen to validate the key."""
    value = str(value or "").strip()
    invariant(value and len(value) <= 2048 and "\n" not in value and "\r" not in value,
              "a devbox needs one SSH public key", "Paste the contents of your .pub file; never your private key.")
    parts = value.split()
    invariant(len(parts) >= 2 and parts[0] in ("ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"),
              "unsupported SSH public key type", "Use a standard Ed25519, RSA or ECDSA .pub file.")
    try:
        wire = base64.b64decode(parts[1], validate=True)
    except ValueError:
        invariant(False, "the SSH public key has invalid base64", "Copy the complete contents of your .pub file.")
    length = int.from_bytes(wire[:4], "big")
    invariant(len(wire) >= 8 and wire[4:4 + length] == parts[0].encode() and len(wire) > 4 + length,
              "the SSH public key is incomplete or has a mismatched type", "Copy the complete contents of your .pub file.")
    if parts[0] == "ssh-ed25519":
        tail = wire[4 + length:]
        invariant(len(tail) == 36 and tail[:4] == (32).to_bytes(4, "big"), "the Ed25519 public key must contain exactly 32 bytes")
    return " ".join(parts[:2])


def devbox_key():
    inline = os.environ.get("FLEET_DEVBOX_SSH_KEY")
    if inline:
        return validate_ssh_key(inline)
    path = Path(os.environ.get("FLEET_DEVBOX_SSH_KEY_FILE") or "/nix/fleet-state/devbox/authorized_keys")
    return validate_ssh_key(path.read_text(encoding="utf-8") if path.is_file() else "")


def enroll_token(argv):
    """Return (rest, token, error). The token is a single-use Vault wrapping
    token for this role's age key. It is read from a file or the environment,
    never from an argument, so it is not left in shell history or ps."""
    rest = []
    path = os.environ.get("FLEET_ENROLL_TOKEN_FILE", "")
    items = iter(argv)
    for item in items:
        if item == "--token" or item.startswith("--token="):
            return argv, None, "Next: pass the token with --token-file PATH or FLEET_ENROLL_TOKEN, not as an argument. Nothing was written."
        if item == "--token-file":
            path = next(items, "")
            if not path:
                return argv, None, "Next: --token-file needs a path. Nothing was written."
        elif item.startswith("--token-file="):
            path = item.split("=", 1)[1]
        else:
            rest.append(item)
    token = os.environ.get("FLEET_ENROLL_TOKEN", "")
    if path:
        try:
            token = Path(path).read_text(encoding="utf-8")
        except OSError:
            return argv, None, "Next: the token file could not be read. Nothing was written."
    token = token.strip()
    if token and not ENROLL_RE.fullmatch(token):
        return argv, None, "Next: the enrollment token is not a Vault token. Nothing was written."
    return rest, token or None, None


def cmd_install(argv, action):
    assume_yes = flag(os.environ.get("FLEET_YES")) or any(a in ("--yes", "-y") for a in argv)
    argv = [a for a in argv if a not in ("--yes", "-y")]
    argv, token, token_error = enroll_token(argv)
    if token_error:
        return fail(token_error, 2)
    if token and action != "install":
        return fail("Next: flash takes no token. Nothing was written.", 2)
    os_name = current_os()
    if os_name not in ("Linux", "Darwin", "Windows"):
        return fail(f"Next: {os_name} cannot start this installer. Nothing was written.", 2)
    role = None
    if action == "install":
        role = load_role(argv[0] if argv else "")
        if role is None:
            return 1
        error = role_error(role)
        if error:
            return fail(error, 2)
        if argv and len(argv) > 1:
            return fail("Next: pass only the role. Nothing was written.", 2)
    elif argv:
        return fail("Next: flash takes no role. Nothing was written.", 2)
    directory = state_dir()
    chosen = choose_disk(os_name, action)
    if not chosen["ok"]:
        return fail(chosen["next"], chosen.get("code", 2))
    # Every check that does not need a person runs before anyone is asked to
    # confirm, so a doomed install never gets as far as the prompt.
    found = preflight(os_name, role, action, token, directory, auto_enroll=action == "install" and enroll_enabled(), disk_path=chosen["path"])
    show_findings(found)
    problems = [item for item in found if item["status"] == "fail"]
    if problems:
        say(f"Result: NOT ready, {len(problems)} problem{'s' if len(problems) != 1 else ''}.")
        return fail(next_for(problems[0]), 2)
    if action == "install" and not token and enroll_enabled() and not installed_for(role, directory):
        token, error = self_enroll(role)
        if error:
            return fail(f"Next: this node was not approved ({error}). Nothing was written. Run this program again, or add --no-enroll to install without the role's shared key.", 2)
        verdict = NET.get("lookup", lookup_token)(token, role)
        if verdict["status"] == "fail":
            return fail(f"Next: the approval token cannot be used ({verdict['detail']}). Nothing was written. Run this program again to be approved again.", 2)
    if action == "install":
        say(f"Role: {role}")
        say(f"Disk: {chosen['plain']}")
        say("This erases that internal disk. Nothing is erased until you confirm the role and the disk.")
        say("Type this line exactly:")
        say(f"{role}: {chosen['plain']}")
        label = role
    else:
        say("Disk: " + chosen["plain"])
        say("This writes the installer onto that USB disk and erases what is on it. The internal disk is not erased.")
        say("Type this line exactly:")
        say("flash: " + chosen["plain"])
        label = "flash"
    if assume_yes:
        say("--yes was given, so the line above is taken as typed. Disk rules still apply.")
    else:
        answer, timed_out = read_answer(os.environ.get("FLEET_CONFIRM_TIMEOUT", "120"))
        error = confirm(label, chosen["plain"], answer, timed_out)
        if error:
            return fail(error, 1)
    again = choose_disk(os_name, action)
    if not again["ok"] or again["disk_id"] != chosen["disk_id"]:
        return fail("Next: the disk changed before it was used. Nothing was written. Run this program again.")
    block = install_block if action == "install" else media_block
    invariant(block(again["disk"]) is None, "the disk about to be erased fails the rules that chose it", disk=again["disk"])
    invariant(device_ok(again["path"]), "the disk about to be erased has an unusable device path", path=again["path"])
    if action == "install" and installed_for(role, directory):
        say(f"This machine is already installed as {role}. The disk was not wiped.")
        return 0
    iso = directory / "fleet-installer.iso"
    fetched = fetch_installer(iso)
    if fetched != 0:
        return fetched
    if action == "install":
        return perform_install(os_name, role, str(iso), token, os.environ.get("FLEET_VAULT_ADDR") or None, directory, chosen)
    written = write_media(os_name, str(iso), chosen["path"])
    if written != 0:
        return written
    say("FLEET-WIPE media")
    say("The USB disk now holds the installer. Boot that disk. On the installer menu choose ci, web, cache, netboot, or devbox. Choose a role and press Enter; every entry erases the internal disk.")
    return 0


def perform_install(os_name, role, iso, token, vault, directory, chosen, on_progress=None):
    """The point of no return, shared by the command line and the wizard. On a
    real machine kexec does not come back; the marker is for the test seam."""
    invariant(role in ROLES, "perform_install was given an unknown role", role=role)
    invariant(chosen.get("ok") and chosen.get("disk_id"), "perform_install needs a chosen disk", chosen=chosen)
    invariant(os.path.isfile(iso) and os.path.getsize(iso) > 0, "perform_install needs the verified installer image", iso=str(iso))
    retire_runner_for_install(directory)
    if os_name == "Windows":
        staged = stage_windows(role, str(iso), token, vault, chosen, on_progress)
    else:
        staged = stage_reboot(os_name, role, str(iso), token, vault)
    if staged != 0:
        return staged
    say(f"FLEET-WIPE role={role}")
    write_text(Path(directory) / "installed", f"role={role}\ndisk={chosen['disk_id']}\nstatus=installed\n")
    say(f"Installed role {role}. The hostname is chosen from the hardware id when the machine boots.")
    return 0


def retire_runner_for_install(directory):
    """An idle CI node withdraws before changing roles; serialize with its
    job-start hook so no project code begins between the check and reboot."""
    previous = node_role(read_kv(os.environ.get("FLEET_NODE_CONF", "/etc/fleet/node.conf")))
    if previous != "ci":
        return
    import fcntl
    root = Path(os.environ.get("FLEET_BUSY_DIR", "/run/fleet"))
    root.mkdir(parents=True, exist_ok=True)
    with open(root / "gate", "a") as gate:
        fcntl.flock(gate, fcntl.LOCK_EX)
        invariant(not job_busy(root), "a runner job started before the reinstall", "Wait for the job to finish, then review again. Nothing was erased.")
        if not checked_marker(directory, "withdrawn"):
            key = os.environ.get("FLEET_CREDENTIAL", "/run/secrets/github-app-key")
            runner = read_kv(os.environ.get("FLEET_RUNNER_CONF", "/etc/fleet/runner.conf"))
            invariant(credential_ready(key, runner), "cannot withdraw this CI node with its current credential",
                      "Restore the CI role's GitHub App credential before reinstalling. Nothing was erased.")
            host = os.environ.get("FLEET_HOSTNAME") or _run(["hostname"]).strip()
            invariant(bool(host), "the CI node has no hostname to withdraw")
            code = call_runner("withdraw", runner, key, host)
            invariant(code == 0, "the CI node could not be withdrawn before reinstalling", "Check GitHub connectivity and the CI credential, then try again. Nothing was erased.", code=code)
            write_text(Path(directory) / "withdrawn", "status=withdrawn\nrole=ci\n")
        write_text(root / "draining", "reinstall\n")


def job_busy(directory):
    root = Path(directory)
    if not root.exists():
        return False
    for candidate in root.rglob("busy"):
        if candidate.is_file():
            return True
    return False


def credential_ready(key_path, conf):
    if not key_path or not os.path.isfile(key_path) or os.path.getsize(key_path) == 0:
        return False
    if not conf:
        return False
    for field in ("scope", "app_id", "installation_id"):
        value = str(conf.get(field) or "")
        if not value or "TODO" in value:
            return False
    targets = conf.get("targets") or []
    if not targets or any("TODO" in target for target in targets):
        return False
    if conf.get("scope") not in ("organization", "repository"):
        return False
    return True


def node_role(conf):
    role = (conf or {}).get("role", "")
    if role in ROLES:
        return role
    return ""


def call_runner(mode, conf, key_path, host):
    tool = os.environ.get("FLEET_RUNNER_CONTROL", "runner-control")
    for target in conf.get("targets") or []:
        completed = subprocess.run(
            [tool, mode, conf["scope"], target, conf["app_id"], conf["installation_id"], key_path, host],
            check=False,
        )
        if completed.returncode != 0:
            return completed.returncode
    return 0


def cmd_remove():
    directory = state_dir()
    busy_root = os.environ.get("FLEET_BUSY_DIR", "/run/fleet")
    key_path = os.environ.get("FLEET_CREDENTIAL", "/run/secrets/github-app-key")
    node = read_kv(os.environ.get("FLEET_NODE_CONF", "/etc/fleet/node.conf"))
    runner = read_kv(os.environ.get("FLEET_RUNNER_CONF", "/etc/fleet/runner.conf"))
    role = node_role(node)
    busy = job_busy(busy_root)
    withdrawn = bool(checked_marker(directory, "withdrawn"))
    ready = credential_ready(key_path, runner)
    plan = removal_plan(busy, ready, withdrawn, role)
    invariant(plan["action"] in ("hold", "withdraw", "retire", "noop", "refuse"), "removal_plan returned an unknown action", action=plan["action"])
    invariant(not plan["stop_job"], "a removal plan must never stop a running job", plan=plan)
    invariant(not (busy and plan["power_off"]), "a removal plan powers off a busy machine", plan=plan)
    if plan["stop_job"]:
        return fail("Next: refusing to stop a running job. Leave this machine on.", 1)
    if plan["action"] in ("hold", "withdraw"):
        host = os.environ.get("FLEET_HOSTNAME")
        if not host:
            try:
                host = _run(["hostname"]).strip()
            except (OSError, RuntimeError):
                return fail("Next: this machine has no hostname to withdraw. Nothing was stopped. Run this program again on the node.")
        code = call_runner(plan["action"], runner, key_path, host)
        if code != 0:
            return fail("Next: the runner could not be withdrawn with the credential already on this machine. Nothing was stopped. Run this program again.", code)
    if plan["action"] == "refuse":
        return fail(plan["next"], plan["code"])
    if plan["next"]:
        say(plan["next"])
    if plan["power_off"]:
        if not withdrawn:
            write_text(directory / "withdrawn", f"status=withdrawn\nrole={role or 'unknown'}\n")
        say("The machine can be powered off.")
        return power_off(role)
    return plan["code"]


def power_off(role):
    """Power a removed fleet node off by itself. Other machines are left on."""
    command = os.environ.get("FLEET_POWEROFF")
    if command is None and not os.environ.get("FLEET_STATE") and role:
        command = "systemctl poweroff"
    if not command:
        return 0
    say("Powering off now.")
    completed = subprocess.run(command.split(), check=False)
    if completed.returncode != 0:
        say("Next: the machine could not be powered off. It is withdrawn and stays out of the fleet. Power it off by hand.")
    return 0


USAGE = """usage: fleet-node.sh COMMAND

  ROLE              install this machine as ci, web, cache, netboot, or devbox
  doctor [ROLE]     read-only: what would be erased, and what stands in the way
  status            health of an installed node
  remove            take this node out of the fleet and power it off
  flash             write the installer to a USB disk
  guide             print the runbook an agent follows

Flags: --yes (take the confirmation as typed), --token-file PATH, --no-enroll (skip the GitHub approval
and let the node make its own key), --json (doctor).
Every run writes a log; its path is printed when something fails.
Agent runbook: """ + GUIDE_URL


def dispatch(argv):
    command = argv[0] if argv else "install"
    rest = argv[1:] if argv else []
    if command in ("help", "-h", "--help"):
        print(USAGE)
        return 0
    if command in ROLES:
        return cmd_install([command, *rest], "install")
    if command == "install":
        return cmd_install(rest, "install")
    if command == "flash":
        return cmd_install(rest, "media")
    if command == "fetch":
        return cmd_fetch(rest)
    if command == "doctor":
        return cmd_doctor(rest)
    if command == "status":
        return cmd_status()
    if command == "remove":
        return cmd_remove()
    error = role_error(command)
    if error and command != "":
        return fail(error, 2)
    return fail("Next: use install, doctor, status, flash, fetch, or remove (help lists them). Nothing was written.", 2)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if any(a in ("--yes", "-y") for a in argv):
        os.environ["FLEET_YES"] = "1"
        argv = [a for a in argv if a not in ("--yes", "-y")]
    if "--no-enroll" in argv:
        os.environ["FLEET_NO_ENROLL"] = "1"
        argv = [a for a in argv if a != "--no-enroll"]
    if argv and argv[0] not in ("help", "-h", "--help"):
        start_log(argv)
    try:
        code = dispatch(argv)
    except KeyboardInterrupt:
        return fail("Next: interrupted. Nothing was written unless FLEET-WIPE was printed above. Run this program again.", 130)
    except Invariant as broken:
        log(traceback.format_exc(), "ERROR")
        for key, value in broken.context.items():
            say(f"  {key}={value}")
        return fail(f"FLEET-INVARIANT {broken.what}\nNext: the program stopped on its own safety check and took no further step. {broken.fix}", 71)
    except Exception as exc:
        log(traceback.format_exc(), "ERROR")
        return fail(f"FLEET-ERROR unexpected {type(exc).__name__}: {exc}\nNext: this is a bug in the program, not in your setup. Run it again; if it repeats, give the log to the maintainer.", 70)
    invariant(isinstance(code, int) and code in (0, 1, 2, 70, 71, 130), "a command returned an exit code outside the documented set", code=code)
    log(f"finished with exit code {code}")
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(1)
