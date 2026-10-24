"""Private Wi-Fi handoff shared by the launcher and the installed system.

No credentials in argv, the kernel command line, logs, or the Nix store.
USB handoffs occupy a reserved trailer outside the verified ISO filesystem.
"""
import gzip
import hashlib
import json
import os
import stat
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

TRAILER_SIZE = 65536
MAGIC = b"FLEET-WIFI-v1".ljust(16, b"\0")
LIVE = Path("/run/fleet-wifi/wifi.json")
PERSISTENT = Path("/nix/fleet-state/network/wifi.json")
PROFILE = Path("/run/NetworkManager/system-connections/fleet-wifi.nmconnection")


class WifiError(Exception):
    """Messages are deliberately credential-free, including malformed input."""


class NetworkUnavailable(WifiError):
    """Retryable only before disk operations or one-time token consumption."""


def require(condition, message):
    if not condition:
        raise WifiError(message)


def utf8_length(value):
    try:
        return len(value.encode("utf-8")) if isinstance(value, str) else -1
    except UnicodeError:
        return -1


def validate(value):
    require(isinstance(value, dict), "Wi-Fi settings must be an object.")
    ssid, password = value.get("ssid"), value.get("password", "")
    auth = value.get("auth", "wpa-psk" if password else "open")
    hidden = value.get("hidden", False)
    require(isinstance(ssid, str) and 1 <= utf8_length(ssid) <= 32 and
            all(ord(c) >= 32 and ord(c) != 127 for c in ssid), "Wi-Fi needs a valid network name of at most 32 bytes.")
    require(isinstance(password, str) and all(ord(c) >= 32 and ord(c) != 127 for c in password),
            "The Wi-Fi password contains unsupported characters.")
    require(auth in ("open", "wpa-psk", "sae") and isinstance(hidden, bool),
            "Automatic Wi-Fi supports open, WPA/WPA2 Personal and WPA3 Personal networks.")
    if auth == "open":
        require(not password, "An open Wi-Fi network must not have a password.")
    elif auth == "wpa-psk":
        require(8 <= utf8_length(password) <= 63 or
                len(password) == 64 and all(c in "0123456789abcdefABCDEF" for c in password),
                "WPA/WPA2 Personal needs an 8–63 byte password or a 64-digit hexadecimal key.")
    else:
        require(1 <= utf8_length(password) <= 63, "WPA3 Personal needs a reusable password.")
    return {"ssid": ssid, "password": password, "auth": auth, "hidden": hidden}


def encode(profile):
    return json.dumps(validate(profile), ensure_ascii=True, sort_keys=True).encode("ascii")


def decode(data):
    require(len(data) <= 4096, "The Wi-Fi handoff is too large.")
    try:
        return validate(json.loads(data))
    except (ValueError, UnicodeError):
        raise WifiError("The Wi-Fi handoff is damaged.") from None


def simulated():
    return any(os.environ.get(k) for k in (
        "FLEET_DISKS_FILE", "FLEET_WINDOWS_TARGET", "FLEET_WRITE_TARGET", "FLEET_ALLOW_UNPRIVILEGED", "FLEET_ALLOW_ANY_OS_INSTALL",
        "FLEET_DD", "FLEET_LSBLK", "FLEET_DISKUTIL", "FLEET_POWERSHELL", "FLEET_OS", "FLEET_EUID", "FLEET_ARCH",
    ))


def discover(os_name, supplied=None):
    if supplied is not None:
        return validate(supplied)
    # Simulated installers must never read the host's saved credentials.
    if simulated():
        return None
    source = os.environ.get("FLEET_WIFI_FILE")
    if source:
        return read_private(Path(source))
    from wifi_capture import capture
    profile = capture(os_name)
    return validate(profile) if profile is not None else None


def connection_id(profile):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "fleet-wifi:" + validate(profile)["ssid"]))


def keyfile(profile):
    p = validate(profile)
    # Numeric SSID bytes avoid keyfile ambiguity for names containing ; or =.
    ssid = ";".join(str(c) for c in p["ssid"].encode()) + ";"
    password = p["password"].replace("\\", "\\\\").replace(" ", "\\s")
    security = "" if p["auth"] == "open" else f"\n[wifi-security]\nkey-mgmt={p['auth']}\npsk={password}\npsk-flags=0\n"
    return (f"[connection]\nid=Fleet Wi-Fi\nuuid={connection_id(p)}\ntype=wifi\nautoconnect=true\nautoconnect-retries=0\n"
            f"\n[wifi]\nmode=infrastructure\nssid={ssid}\nhidden={'true' if p['hidden'] else 'false'}\npowersave=2\n"
            f"{security}\n[ipv4]\nmethod=auto\nroute-metric=600\n\n[ipv6]\nmethod=auto\nroute-metric=600\n")


def write_private(path, data):
    path = Path(path)
    require(not path.is_symlink() and not path.parent.is_symlink(), "The Wi-Fi handoff path is not a private regular file.")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, name = tempfile.mkstemp(prefix=".fleet-wifi-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name == "posix":
            directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def read_private(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077 and info.st_uid == getattr(os, "geteuid", lambda: 0)(),
                "Wi-Fi settings must be a private file owned by the current user.")
        return decode(handle.read(4097))


def initrd(profile):
    """A gzip newc archive: Linux accepts concatenated initramfs members."""
    def member(name, body, mode, ino):
        name = name.encode() + b"\0"
        fields = [ino, mode, 0, 0, 1, 0, len(body), 0, 0, 0, 0, len(name), 0]
        header = b"070701" + b"".join(f"{v:08x}".encode() for v in fields)
        entry = header + name
        entry += b"\0" * (-len(entry) % 4)
        return entry + body + b"\0" * (-len(body) % 4)
    archive = member("fleet-wifi.json", encode(profile), stat.S_IFREG | 0o600, 1)
    archive += member("TRAILER!!!", b"", 0, 2)
    return gzip.compress(archive, mtime=0)


def trailer(profile):
    if profile is None:
        return bytes(TRAILER_SIZE)
    data = encode(profile)
    result = MAGIC + struct.pack(">I", len(data)) + hashlib.sha256(data).digest() + data
    return result.ljust(TRAILER_SIZE, b"\0")


def read_trailer(device):
    with open(device, "rb", buffering=0) as handle:
        handle.seek(-TRAILER_SIZE, os.SEEK_END)
        data = handle.read(TRAILER_SIZE)
    if data[:16] != MAGIC:
        return None
    length = struct.unpack(">I", data[16:20])[0]
    require(0 < length <= 4096 and len(data) == TRAILER_SIZE, "The USB Wi-Fi handoff is incomplete.")
    payload = data[52:52 + length]
    require(hashlib.sha256(payload).digest() == data[20:52], "The USB Wi-Fi handoff failed its integrity check.")
    return decode(payload)


def write_trailer(device, capacity, image_size, profile):
    padded = (image_size + 4095) // 4096 * 4096
    require(capacity >= padded + TRAILER_SIZE, "The USB needs 64 KiB of free space after the installer image for Wi-Fi settings.")
    data = trailer(profile)
    testing = simulated()
    if testing:
        try:
            mode = os.lstat(device).st_mode
        except OSError:
            mode = 0
        require(stat.S_ISREG(mode), "Simulated Wi-Fi writes require an existing regular file, never a device or symlink.")
    flags = getattr(os, "O_BINARY", 0) | (getattr(os, "O_NOFOLLOW", 0) if testing else 0)
    with os.fdopen(os.open(device, os.O_RDWR | flags), "r+b", buffering=0) as handle:
        require(not testing or stat.S_ISREG(os.fstat(handle.fileno()).st_mode), "A simulated Wi-Fi write cannot target a device.")
        handle.seek(capacity - TRAILER_SIZE)
        require(handle.write(data) == len(data), "The USB accepted an incomplete Wi-Fi handoff.")
        os.fsync(handle.fileno())
    with os.fdopen(os.open(device, os.O_RDONLY | flags), "rb", buffering=0) as handle:
        require(not testing or stat.S_ISREG(os.fstat(handle.fileno()).st_mode), "A simulated Wi-Fi read cannot target a device.")
        handle.seek(capacity - TRAILER_SIZE)
        require(handle.read(TRAILER_SIZE) == data, "The USB Wi-Fi handoff did not read back correctly.")


def removable_devices(root=Path("/sys/class/block")):
    for entry in root.iterdir():
        if (entry / "partition").exists():
            continue
        try:
            if (entry / "removable").read_text().strip() == "1" or "/usb" in str(entry.resolve()):
                yield Path("/dev") / entry.name
        except OSError:
            continue


def prepare(live=LIVE, persistent=PERSISTENT, target=PROFILE, devices=None):
    if live.exists():
        profile = read_private(live)
    elif persistent.exists():
        profile = read_private(persistent)
    else:
        profiles = []
        for device in removable_devices() if devices is None else devices:
            try:
                profile = read_trailer(device)
            except OSError:
                continue
            if profile is not None:
                profiles.append(profile)
        require(len({encode(p) for p in profiles}) <= 1, "Conflicting USB Wi-Fi handoffs are attached. Leave only the intended installer connected.")
        profile = profiles[0] if profiles else None
    if profile is not None:
        write_private(live, encode(profile))
        write_private(target, keyfile(profile).encode())
    return profile


def internet_ready():
    # Verify DNS and TLS, so a captive portal cannot masquerade as readiness.
    with urllib.request.urlopen("https://github.com/robots.txt", timeout=15) as response:
        require(response.status == 200, "Wi-Fi has not reached the internet.")


def ready(profile, run=subprocess.run, sleep=time.sleep, probe=internet_ready):
    for attempt in range(3):
        try:
            run(["nmcli", "radio", "wifi", "on"], capture_output=True, timeout=10, check=False)
            result = run(["nmcli", "--wait", "45", "connection", "up", "uuid", connection_id(profile)],
                         capture_output=True, timeout=55, check=False)
            if result.returncode == 0:
                probe()
                return
        except (OSError, subprocess.TimeoutExpired, WifiError):
            pass
        if attempt < 2:
            sleep(3 * (attempt + 1))
    raise NetworkUnavailable("Wi-Fi did not connect with working DNS and TLS. Nothing was erased. Check the network/password or use a network without a captive portal.")


def main(args):
    if args == ["prepare"]:
        prepare()
    elif args == ["ready"]:
        profile = read_private(LIVE) if LIVE.exists() else discover("Linux")
        if profile is not None:
            write_private(LIVE, encode(profile))
            write_private(PROFILE, keyfile(profile).encode())
            try:
                loaded = subprocess.run(["nmcli", "connection", "load", str(PROFILE)], capture_output=True, timeout=20, check=False)
            except (OSError, subprocess.TimeoutExpired):
                raise NetworkUnavailable("The Wi-Fi service is not ready. Nothing was erased.") from None
            if loaded.returncode != 0:
                raise NetworkUnavailable("The Wi-Fi service could not load the private profile. Nothing was erased.")
            ready(profile)
        else:
            # Missing firmware can hide the wireless adapter entirely. Never
            # interpret its absence as permission to erase an offline machine.
            try:
                result = subprocess.run(["ip", "route", "show", "default"], capture_output=True, timeout=10, check=False)
                ipv6 = subprocess.run(["ip", "-6", "route", "show", "default"], capture_output=True, timeout=10, check=False)
                if not result.stdout.strip() and not ipv6.stdout.strip():
                    raise NetworkUnavailable("No network connection is available. Nothing was erased.")
                internet_ready()
            except (OSError, subprocess.TimeoutExpired, WifiError):
                raise NetworkUnavailable("Waiting for a working network connection. Nothing was erased.") from None
    elif len(args) == 2 and args[0] == "persist":
        if LIVE.exists():
            profile = read_private(LIVE)
            destination = Path(args[1]) / "nix/fleet-state/network/wifi.json"
            write_private(destination, encode(profile))
            require(read_private(destination) == profile, "Installed Wi-Fi settings failed read-back verification.")
    else:
        raise WifiError("Unknown Wi-Fi handoff operation.")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except NetworkUnavailable:
        print("Waiting for Wi-Fi with working DNS and TLS. Nothing was erased; the installer will retry automatically.", file=sys.stderr)
        sys.exit(75)
    except WifiError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    except OSError:
        # Never emit exception repr, profile contents or subprocess output.
        print("Fleet Wi-Fi setup failed. Check Wi-Fi credentials and connectivity before retrying; disk installation was stopped.", file=sys.stderr)
        sys.exit(2)
