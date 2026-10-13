import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("guard", Path(__file__).parents[1] / "scripts/disk-guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

class DiskGuardTests(unittest.TestCase):
    def disk(self, **changes):
        return dict(path="/dev/nvme0n1", type="disk", tran="nvme", rm=False, hotplug=False, mountpoints=[None], **changes)

    def check(self, disks, path="/dev/disk/by-path/pci-verified-nvme-1"):
        with patch.object(guard.os.path, "realpath", return_value="/dev/nvme0n1"):
            return guard.validate(path, disks)

    def test_internal_unmounted_nvme(self):
        self.assertEqual(self.check([self.disk()]), "/dev/nvme0n1")

    def test_rejects_mounted_descendant(self):
        with self.assertRaises(ValueError):
            self.check([self.disk(children=[dict(mountpoints=["/iso"], children=[])])])

    def test_rejects_usb_and_removable_and_hotplug(self):
        for key, value in [("tran", "usb"), ("rm", True), ("hotplug", True), ("type", "part")]:
            disk = self.disk()
            disk[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check([disk])

    def test_rejects_missing_duplicate_and_unstable(self):
        for disks in ([], [self.disk(), self.disk()]):
            with self.assertRaises(ValueError): self.check(disks)
        for path in ("/dev/nvme0n1", "/dev/disk/by-path/TODO-internal-nvme"):
            with self.assertRaises(ValueError): self.check([self.disk()], path)
