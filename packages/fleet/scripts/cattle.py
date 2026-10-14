"""Role and capability identity for interchangeable machines.

No function here reads a per-machine config file. Disk choice, the stable id,
the hostname, and the runner slot count come from the live machine plus the
role constants in /etc/fleet/node.conf.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

DEVICE_RE = re.compile(r"^/dev/[A-Za-z0-9._/:-]+$")
MAC_RE = re.compile(r"^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$")
HOST_ROLES = {"ci", "web", "cache", "netboot", "devbox"}
HOST_CAPABILITIES = {"gpu"}
# Hostname tags, in this order. The runner label for highmem is high-mem.
TAG_ORDER = ("gpu", "highmem")
ARCH_LABELS = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}
TRAN_RANK = {"nvme": 0, "sata": 1, "ata": 1, "sas": 2, "scsi": 2, "virtio": 3}
DMI_REJECT = {"", "none", "not present", "not settable"}

# Nix files only. scripts/flash-usb.sh may name the operator's USB stick.
BANNED = (
    (re.compile(r"/dev/nvme\d"), "hardcoded NVMe kernel path"),
    (re.compile(r"/dev/sd[a-z]\b"), "hardcoded disk kernel path"),
    (re.compile(r"/dev/disk/by-id/"), "hardcoded disk by-id path"),
    (re.compile(r"/dev/disk/by-path/\S+"), "hardcoded disk by-path"),
    (re.compile(r"/dev/disk/by-uuid/"), "hardcoded filesystem UUID"),
    (re.compile(r"[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}"), "hardcoded MAC address"),
    (re.compile(r"""networking\.hostName\s*=\s*(?:lib\.mkForce\s*)?"[^"]+"|networking\.hostName\s*=\s*lib\.mkForce\s+"[^"]+"""), "static hostname"),
    (re.compile(r"\b(?:enp|eno|ens|eth|wlan|wlp)\d"), "hardcoded interface name"),
)


def die(message, code=1):
    print(message, file=sys.stderr)
    raise SystemExit(code)


def _flag(value):
    if value is True:
        return True
    if value in (False, None, "", 0, "0"):
        return False
    return int(value) != 0


def _mounted(device):
    if any(device.get("mountpoints") or []):
        return True
    return any(_mounted(child) for child in device.get("children") or [])


def select_disk(disks, links_for):
    """Require one unambiguous internal disk.

    Removable, hotplug, USB, and anything with a mounted descendant are skipped.
    The published path is the lowest /dev/disk/by-path link when one exists.
    """
    chosen = []
    for disk in disks:
        if disk.get("type") != "disk":
            continue
        tran = str(disk.get("tran") or "").lower()
        if tran not in TRAN_RANK or tran == "usb":
            continue
        if _flag(disk.get("rm")) or _flag(disk.get("hotplug")) or _mounted(disk):
            continue
        kernel = str(disk.get("path") or "")
        if not DEVICE_RE.fullmatch(kernel):
            continue
        links = sorted(
            link for link in links_for(kernel)
            if link.startswith("/dev/disk/by-path/") and DEVICE_RE.fullmatch(link)
        )
        publish = links[0] if links else kernel
        chosen.append((TRAN_RANK[tran], publish, publish))
    if not chosen:
        raise ValueError("no eligible internal disk (NVMe, then SATA; USB, removable, and mounted disks are skipped)")
    if len(chosen) != 1:
        raise ValueError("more than one eligible internal disk; disconnect other internal disks before installing. Nothing was wiped")
    chosen.sort()
    return chosen[0][2]


def by_path_links(kernel_path, root="/dev/disk/by-path"):
    directory = Path(root)
    if not directory.is_dir():
        return []
    try:
        real = os.path.realpath(kernel_path)
    except OSError:
        return []
    found = []
    for name in sorted(os.listdir(directory)):
        link = directory / name
        try:
            if os.path.realpath(link) == real:
                found.append(str(link))
        except OSError:
            continue
    return found


def normalize_uuid(text):
    if text is None:
        return None
    value = str(text).strip().lower()
    if value in DMI_REJECT:
        return None
    hexes = value.replace("-", "")
    if not hexes or set(hexes) <= {"0"}:
        return None
    return value


def stable_id(uuid_text, mac):
    """First 4 hex digits of sha256. 65536 values can collide; the UUID makes that unlikely."""
    uuid = normalize_uuid(uuid_text)
    if uuid:
        material = "dmi:" + uuid
    else:
        if mac is None or not MAC_RE.fullmatch(str(mac).strip().lower()):
            raise ValueError("no DMI system UUID or permanent MAC")
        material = "mac:" + str(mac).strip().lower().replace(":", "")
    return hashlib.sha256(material.encode()).hexdigest()[:4]


def primary_mac(net_root="/sys/class/net"):
    root = Path(net_root)
    if not root.is_dir():
        return None
    found = []
    for nic in root.iterdir():
        if not (nic / "device").exists():
            continue
        assign = nic / "addr_assign_type"
        address = nic / "address"
        if not assign.is_file() or not address.is_file():
            continue
        if assign.read_text(encoding="utf-8").strip() != "0":
            continue
        mac = address.read_text(encoding="utf-8").strip().lower()
        if MAC_RE.fullmatch(mac):
            found.append(mac)
    return sorted(found)[0] if found else None


def read_dmi_uuid(path="/sys/class/dmi/id/product_uuid"):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError:
        return None


def read_stable_id(attempts=10, delay=0.2, uuid_path="/sys/class/dmi/id/product_uuid", net_root="/sys/class/net"):
    uuid = normalize_uuid(read_dmi_uuid(uuid_path))
    if uuid:
        return stable_id(uuid, None)
    for attempt in range(attempts):
        mac = primary_mac(net_root)
        if mac:
            return stable_id(None, mac)
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise ValueError("no DMI system UUID or permanent MAC")


def is_high_mem(ram_mib, high_mem_gib):
    return int(ram_mib) > int(high_mem_gib) * 1024


def slot_count(cores, ram_mib, reserve_gib, per_runner_gib, per_runner_cores, slot_max):
    """One formula for every CI machine. Bad inputs clamp; the result is at least 1."""
    cores = max(0, int(cores))
    ram_mib = max(0, int(ram_mib))
    reserve_gib = max(0, int(reserve_gib))
    per_runner_gib = max(1, int(per_runner_gib))
    per_runner_cores = max(1, int(per_runner_cores))
    slot_max = max(1, int(slot_max))
    cpu_slots = cores // per_runner_cores
    mem_slots = max(0, (ram_mib - reserve_gib * 1024) // (per_runner_gib * 1024))
    return min(slot_max, max(1, min(cpu_slots, mem_slots)))


def mem_total_mib(meminfo):
    for line in str(meminfo).splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) // 1024
    raise ValueError("MemTotal missing")


def physical_cores(cpu_root="/sys/devices/system/cpu"):
    """Unique (package, core) pairs. QEMU often reports core_id 0 for every CPU; use the online count then."""
    root = Path(cpu_root)
    cpus = [path for path in root.glob("cpu[0-9]*") if path.name[3:].isdigit()]
    online = []
    for cpu in cpus:
        online_file = cpu / "online"
        if online_file.is_file() and online_file.read_text(encoding="utf-8").strip() == "0":
            continue
        online.append(cpu)
    if not online:
        online = cpus
    pairs = set()
    for cpu in online:
        package = cpu / "topology" / "physical_package_id"
        core = cpu / "topology" / "core_id"
        if not package.is_file() or not core.is_file():
            return max(1, len(online))
        pairs.add((package.read_text(encoding="utf-8").strip(), core.read_text(encoding="utf-8").strip()))
    if len(online) > 1 and pairs and all(core == "0" for _, core in pairs):
        return len(online)
    if pairs:
        return len(pairs)
    return max(1, len(online))


def capability_tags(cap_dir, ram_mib, high_mem_gib):
    """Software capabilities come from files the closure installed. highmem is memory, not a build."""
    tags = []
    gpu = Path(cap_dir) / "gpu"
    if gpu.is_file() and "gpu" in gpu.read_text(encoding="utf-8").split():
        tags.append("gpu")
    if is_high_mem(ram_mib, high_mem_gib):
        tags.append("highmem")
    return [tag for tag in TAG_ORDER if tag in tags]


def hostname_for(role, tags, ident):
    if role not in HOST_ROLES:
        raise ValueError("role must be ci, web, cache, netboot, or devbox")
    if not re.fullmatch(r"[0-9a-f]{4}", ident or ""):
        raise ValueError("id must be 4 hex digits")
    unknown = set(tags) - set(TAG_ORDER)
    if unknown:
        raise ValueError("unknown capability tag")
    ordered = [tag for tag in TAG_ORDER if tag in tags]
    return "-".join([role, *ordered, ident])


def runner_labels(arch, tags):
    labels = []
    mapped = ARCH_LABELS.get(arch)
    if mapped:
        labels.append(mapped)
    if "gpu" in tags:
        labels.append("gpu")
    if "highmem" in tags:
        labels.append("high-mem")
    return labels


def load_conf(path):
    data = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip("'\"")
    return data


def _write(path, text, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o755)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        os.write(fd, text.encode())
    finally:
        os.close(fd)
    os.chmod(path, mode)


def apply_identity(root, conf, ident, ram_mib, arch, set_hostname, cores=None):
    role = conf["role"]
    tags = capability_tags(
        Path(root) / "etc/fleet/capabilities.d",
        ram_mib,
        int(conf["high_mem_gib"]),
    )
    hostname = hostname_for(role, tags, ident)
    set_hostname(hostname)
    node = "\n".join([
        f"hostname={hostname}",
        f"role={role}",
        f"id={ident}",
        f"capabilities={','.join(tags)}",
        f"arch={arch}",
        "",
    ])
    _write(Path(root) / "run/fleet/node", node, 0o644)
    _write(
        Path(root) / "run/fleet/runner-labels",
        "".join(f"{label}\n" for label in runner_labels(arch, tags)),
        0o644,
    )
    if role == "ci":
        counted = physical_cores(str(Path(root) / "sys/devices/system/cpu")) if cores is None else cores
        slots = slot_count(
            counted,
            ram_mib,
            conf["reserve_gib"],
            conf["per_runner_gib"],
            conf["per_runner_cores"],
            conf["slot_max"],
        )
        fleet = Path(root) / "run/fleet"
        _write(fleet / "slot-count", f"{slots}\n", 0o644)
        _write(fleet / "identity", f"ACTIONS_RUNNER_INPUT_NAME={hostname}\n", 0o644)
    else:
        for name in ("identity", "slot-count"):
            stale = Path(root) / "run/fleet" / name
            if stale.exists():
                stale.unlink()
    return hostname


def host_allowed(stem):
    parts = stem.split("-")
    return bool(parts) and parts[0] in HOST_ROLES and all(part in HOST_CAPABILITIES for part in parts[1:])


def check_tree(root):
    root = Path(root)
    errors = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if path.name == "hardware-configuration.nix":
            errors.append(f"{rel}: hardware-configuration.nix is per-machine. Use modules/hardware/generic.nix.")
        if rel.parts[:1] == ("profiles",) and path.suffix == ".nix":
            errors.append(f"{rel}: profiles/ is a machine model. Add a capability module or extend the generic profile.")
        if len(rel.parts) == 2 and rel.parts[0] == "hosts" and path.suffix == ".nix" and not host_allowed(path.stem):
            errors.append(
                f"{rel}: per-machine host file. hosts/ only allows a role plus capability, for example ci.nix or ci-gpu.nix."
            )
        if path.suffix != ".nix":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for pattern, reason in BANNED:
                if pattern.search(line):
                    errors.append(f"{rel}:{number}: {reason}")
    return errors


def cmd_select_disk():
    try:
        raw = subprocess.check_output(
            ["lsblk", "--json", "--paths", "--output", "PATH,TYPE,TRAN,RM,HOTPLUG,MOUNTPOINTS"],
            text=True,
        )
        disks = json.loads(raw).get("blockdevices") or []
        path = select_disk(disks, by_path_links)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError, ValueError) as exc:
        die(f"select-disk: {exc}")
    if not DEVICE_RE.fullmatch(path):
        die("select-disk: refusing an unusual device path")
    print(path)


def cmd_print_id():
    try:
        print(read_stable_id())
    except ValueError as exc:
        die(f"print-id: {exc}")


def cmd_identity():
    try:
        conf = load_conf("/etc/fleet/node.conf")
        ident = read_stable_id()
        ram = mem_total_mib(Path("/proc/meminfo").read_text(encoding="utf-8"))
        arch = os.uname().machine

        def set_hostname(hostname):
            subprocess.run(
                ["hostnamectl", "--transient", "--no-ask-password", "set-hostname", hostname],
                check=True,
            )

        apply_identity("/", conf, ident, ram, arch, set_hostname, cores=physical_cores())
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError) as exc:
        die(f"identity: {exc}")


def cmd_check(root):
    errors = check_tree(root)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        raise SystemExit(1)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        die("usage: cattle.py select-disk|identity|print-id|check ROOT", 2)
    command, rest = argv[0], argv[1:]
    if command == "select-disk":
        cmd_select_disk()
    elif command == "identity":
        cmd_identity()
    elif command == "print-id":
        cmd_print_id()
    elif command == "check":
        cmd_check(rest[0] if rest else ".")
    else:
        die(f"unknown command {command}", 2)


if __name__ == "__main__":
    main()
