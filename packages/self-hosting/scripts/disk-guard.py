"""Fail closed: only a stable internal NVMe path, never any mounted backing disk."""
import json
import os
import subprocess
import sys


def validate(stable, disks):
    if not stable.startswith(("/dev/disk/by-id/", "/dev/disk/by-path/")) or "TODO" in stable:
        raise ValueError("Set a verified stable internal NVMe path")
    target = os.path.realpath(stable)
    candidates = [d for d in disks if d["path"] == target]
    if len(candidates) != 1:
        raise ValueError("Target must be one whole physical disk")
    disk = candidates[0]
    if disk.get("type") != "disk" or disk.get("tran") != "nvme" or int(disk.get("rm") or 0) != 0 or int(disk.get("hotplug") or 0) != 0:
        raise ValueError("Target is not a non-removable internal NVMe")
    def mounted(device):
        return any(device.get("mountpoints") or []) or any(mounted(c) for c in device.get("children", []))
    if mounted(disk):
        raise ValueError("Target or descendant is mounted (possibly the boot medium)")
    return target


def main():
    disks = json.loads(subprocess.check_output(["lsblk", "--json", "--paths", "--output",
        "PATH,TYPE,TRAN,RM,HOTPLUG,MOUNTPOINTS"], text=True))["blockdevices"]
    print("Verified install target: " + validate(sys.argv[1], disks))


if __name__ == "__main__":
    main()
