#!/usr/bin/env python3
"""The pieces of converting a Windows computer in place, one at a time. The whole
sequence (shrink, write, boot entry, undo) is exercised through the shipped
entry in test_fleet_node.py; these cover the parts that decide whether it is safe."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso_fixture  # noqa: E402

sys.path.insert(0, str(ROOT / "wizard"))
import bootstrap  # noqa: E402,F401
import decide  # noqa: E402

GOOD = {"Letter": "C", "DiskNumber": 0, "PartitionNumber": 3, "Size": 500 * 1024 ** 3, "SizeMin": 100 * 1024 ** 3,
        "SizeMax": 500 * 1024 ** 3, "Style": "GPT", "EspNumber": 1, "SecureBoot": False, "Firmware": 2}
DRIVE0 = "\\\\.\\PHYSICALDRIVE0"


class WriteRegionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.iso = self.root / "image.iso"
        self.iso.write_bytes(bytes(range(256)) * 400 + b"tail")  # not a multiple of the sector size
        self.disk = self.root / "disk.img"
        self.disk.write_bytes(b"\xee" * (1024 * 1024 + 300000))

    def test_the_image_lands_at_the_offset_and_nothing_else_moves(self):
        offset = 8192
        decide.write_region(self.iso, self.disk, offset)
        raw, image = self.disk.read_bytes(), self.iso.read_bytes()
        self.assertEqual(raw[:offset], b"\xee" * offset)
        self.assertEqual(raw[offset:offset + len(image)], image)
        padded = offset + decide.padded_size(len(image))
        self.assertEqual(raw[padded:], b"\xee" * (len(raw) - padded), "only the padded sector may be touched past the image")

    def test_the_hybrid_boot_sector_is_written_as_zeros(self):
        decide.write_region(self.iso, self.disk, 4096, zero_head=2048)
        raw, image = self.disk.read_bytes(), self.iso.read_bytes()
        self.assertEqual(raw[4096:4096 + 2048], bytes(2048))
        self.assertEqual(raw[4096 + 2048:4096 + len(image)], image[2048:])

    def test_progress_reaches_the_end(self):
        seen = []
        decide.write_region(self.iso, self.disk, 0, on_progress=lambda done, total: seen.append((done, total)))
        self.assertEqual(seen[-1][0], seen[-1][1])

    def test_a_bad_read_back_is_an_error(self):
        real = os.read
        calls = []

        def flipped(fd, count):
            data = real(fd, count)
            calls.append(1)
            return bytes([data[0] ^ 1]) + data[1:] if data else data

        with mock.patch("os.read", flipped):
            with self.assertRaises(decide.Invariant) as caught:
                decide.write_region(self.iso, self.disk, 0)
        self.assertIn("does not hold the installer", caught.exception.what)

    def test_an_unaligned_offset_is_refused(self):
        with self.assertRaises(decide.Invariant):
            decide.write_region(self.iso, self.disk, 513)


class GrubConfigTest(unittest.TestCase):
    def test_the_entry_boots_the_chosen_role_from_the_image(self):
        config = decide.grub_config("web", "/boot/k", "/boot/i", "root=LABEL=X copytoram fleet.role=web")
        self.assertIn("search --no-floppy --set=root --file /EFI/nixos-installer-image", config)
        self.assertIn("linux /boot/k root=LABEL=X copytoram fleet.role=web\n", config)
        self.assertIn("initrd /boot/i\n", config)
        self.assertIn("installs web", config)

    def test_a_value_that_could_break_out_of_the_entry_is_refused(self):
        for bad in ("a\nb", "a'b", "a\rb"):
            with self.assertRaises(decide.Invariant):
                decide.grub_config("ci", "/boot/k", "/boot/i", bad)
        with self.assertRaises(decide.Invariant):
            decide.grub_config("root", "/boot/k", "/boot/i", "x")


class BootMaterialTest(unittest.TestCase):
    def test_each_role_gets_its_own_entry_and_the_grub_program(self):
        with tempfile.TemporaryDirectory() as tmp:
            iso = Path(tmp) / "i.iso"
            iso.write_bytes(iso_fixture.build(iso_fixture.installer_tree(grub=b"GRUB-PROGRAM")))
            for role in decide.ROLES:
                linux, initrd, append, grub = decide.iso_boot_material(iso, role)
                self.assertEqual((linux, initrd, grub), ("/boot/bzImage", "/boot/initrd", b"GRUB-PROGRAM"))
                self.assertTrue(append.split()[-1] == f"fleet.role={role}" or f"fleet.role={role}" in append.split(), append)
            self.assertIn("root=LABEL=FLEET_ISO", append)

    def test_an_image_with_no_grub_program_is_refused(self):
        tree = iso_fixture.installer_tree()
        del tree["EFI"]["BOOT"]
        with tempfile.TemporaryDirectory() as tmp:
            iso = Path(tmp) / "i.iso"
            iso.write_bytes(iso_fixture.build(tree))
            with self.assertRaises(decide.Invariant) as caught:
                decide.iso_boot_material(iso, "ci")
            self.assertIn("latest Fleet installer", caught.exception.fix, "a layout this program does not know points at a newer installer")

    def test_an_image_without_the_boot_marker_is_refused_before_windows_changes(self):
        tree = iso_fixture.installer_tree()
        del tree["EFI"]["nixos-installer-image"]
        with tempfile.TemporaryDirectory() as tmp:
            iso = Path(tmp) / "i.iso"
            iso.write_bytes(iso_fixture.build(tree))
            with self.assertRaises(decide.Invariant) as caught:
                decide.iso_boot_material(iso, "ci")
            self.assertIn("nixos-installer-image", caught.exception.context["problem"])


class FindingsTest(unittest.TestCase):
    def check(self, size=6 * 1024 ** 3, path=DRIVE0, **changes):
        with mock.patch.object(decide, "windows_facts", return_value={**GOOD, **changes}), \
                mock.patch.object(decide.shutil, "which", return_value="bcdedit"):
            return {item["name"]: item for item in decide.windows_findings(size, path)}

    def test_a_ready_machine_has_no_problem(self):
        found = self.check()
        self.assertEqual({item["status"] for item in found.values()}, {"ok"}, found)

    def test_each_blocker_names_its_own_fix(self):
        cases = {
            "firmware": ({"Firmware": 1}, "UEFI"),
            "secure-boot": ({"SecureBoot": True}, "shutdown /r /fw"),
            "partition-style": ({"Style": "MBR"}, "flash"),
            "efi-partition": ({"EspNumber": None}, "flash"),
            "system-disk": ({"DiskNumber": 1}, "Disconnect"),
            "shrink": ({"SizeMin": GOOD["Size"] - 100}, "powercfg /h off"),
        }
        for name, (change, needle) in cases.items():
            with self.subTest(name=name):
                item = self.check(**change)[name]
                self.assertEqual(item["status"], "fail")
                self.assertIn(needle, item["fix"])

    def test_unknown_secure_boot_is_a_warning_not_a_block(self):
        self.assertEqual(self.check(SecureBoot=None)["secure-boot"]["status"], "warn")

    def test_a_missing_release_size_still_checks_the_shrink_with_an_estimate(self):
        self.assertEqual(self.check(size=None)["shrink"]["status"], "ok")
        self.assertEqual(self.check(size=None, SizeMin=GOOD["Size"] - 1024 ** 3)["shrink"]["status"], "fail")

    def test_no_bcdedit_stops_at_once(self):
        with mock.patch.object(decide.shutil, "which", return_value=None), mock.patch.dict(os.environ, {"FLEET_BCDEDIT": "/nope"}):
            found = decide.windows_findings(1, None)
        self.assertEqual([item["name"] for item in found], ["boot-tool"])
        self.assertEqual(found[0]["status"], "fail")

    def test_a_query_that_cannot_run_is_a_failed_check_not_a_crash(self):
        broken = decide.Invariant("a Windows disk command failed", "", {})
        with mock.patch.object(decide, "windows_facts", side_effect=broken), mock.patch.object(decide.shutil, "which", return_value="x"):
            found = decide.windows_findings(1, None)
        self.assertEqual(found[-1]["name"], "windows")
        self.assertEqual(found[-1]["status"], "fail")

    def test_the_unelevated_review_defers_instead_of_failing(self):
        broken = decide.Invariant("a Windows disk command failed", "", {})
        with mock.patch.object(decide, "windows_facts", side_effect=broken), mock.patch.object(decide.shutil, "which", return_value="x"):
            review = decide.windows_findings(1, None, strict=False)
            elevated = decide.windows_findings(1, None, strict=True)
        self.assertEqual(review[-1]["status"], "info")
        self.assertIn("administrator prompt", review[-1]["detail"])
        self.assertEqual(elevated[-1]["status"], "fail")

    def test_the_space_needed_includes_the_margin_and_is_mib_aligned(self):
        need = decide.windows_need(6 * 1024 ** 3 + 1)
        self.assertEqual(need % decide.MIB, 0)
        self.assertGreaterEqual(need, 6 * 1024 ** 3 + 1 + decide.WINDOWS_MARGIN)


class TargetTest(unittest.TestCase):
    def test_the_redirect_accepts_only_a_regular_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            plain = Path(tmp) / "disk.img"
            plain.write_bytes(b"")
            link = Path(tmp) / "link"
            link.symlink_to(plain)
            with mock.patch.dict(os.environ, {"FLEET_WINDOWS_TARGET": str(plain)}):
                self.assertEqual(decide.windows_disk_target(0), str(plain))
            for bad in (str(link), "/dev/null", str(Path(tmp) / "missing")):
                with mock.patch.dict(os.environ, {"FLEET_WINDOWS_TARGET": bad}):
                    with self.assertRaises(decide.Invariant, msg=bad):
                        decide.windows_disk_target(0)

    def test_without_the_redirect_it_is_the_physical_drive(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("FLEET_WINDOWS_TARGET", None)
            self.assertEqual(decide.windows_disk_target(3), "\\\\.\\PHYSICALDRIVE3")


class UndoTest(unittest.TestCase):
    def test_every_step_runs_newest_first_even_when_one_fails(self):
        order = []

        def failing():
            order.append("b")
            raise RuntimeError("busy")

        undo = decide.WindowsUndo()
        undo.add("a", lambda: order.append("a"))
        undo.add("b", failing)
        undo.add("c", lambda: order.append("c"))
        undo.run()
        self.assertEqual(order, ["c", "b", "a"])


if __name__ == "__main__":
    unittest.main()
