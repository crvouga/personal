#!/usr/bin/env python3
"""The whole Windows conversion in one process against a model of Windows (partitions, the EFI
system partition, bcdedit, UEFI variables, shutdown), with a failure injected after each step.
Whatever step fails, the model must end up exactly as it started."""

import json
import os
import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso_fixture  # noqa: E402
from test_windows_firmware import FakeFirmware  # noqa: E402

sys.path.insert(0, str(ROOT / "wizard"))
import bootstrap  # noqa: E402,F401
import decide  # noqa: E402

ENTRY = "{11111111-2222-3333-4444-555555555555}"
C_SIZE = 500 * 1024 ** 3
FACTS = {"Letter": "C", "DiskNumber": 0, "PartitionNumber": 3, "Size": C_SIZE, "SizeMin": 100 * 1024 ** 3, "SizeMax": C_SIZE,
         "Style": "GPT", "EspNumber": 1, "Esps": [{"Number": 1, "Size": 104857600}], "SecureBoot": False, "Firmware": 2,
         "LogicalSectorSize": 512, "Memory": 64 * 1024 ** 3, "Dynamic": False, "OnBattery": False, "BitLocker": None, "BusType": "NVMe"}
ESP_PART = {"DiskNumber": 0, "Number": 1, "Offset": 1048576, "Size": 104857600, "Guid": "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}",
            "GptType": decide.ESP_GUID.upper(), "LogicalSectorSize": 512}


class World:
    """Windows, as far as the conversion can tell. Every do and undo is a method on the model, so a
    test can read the state back after a failure. fail_at names the operation that raises."""

    def __init__(self, root, firmware=None, facts=None):
        self.root = Path(root)
        self.esp = self.root / "esp"
        self.esp.mkdir()
        self.disk = self.root / "disk.img"
        with open(self.disk, "wb") as handle:
            handle.truncate(32 * 1024 * 1024)
        self.facts = dict(FACTS, **(facts or {}))
        self.c_size = self.facts["Size"]
        self.partitions = []
        self.mounted = False
        self.entries, self.order, self.sequence = set(), [], None
        self.hide_sequence = False
        self.firmware = firmware
        self.fail_at = set()
        self.ops = []
        self.restart = None  # None, "scheduled", "aborted"
        self.esp_part = dict(ESP_PART)
        self.free = None

    # -- injection
    def maybe_fail(self, op):
        self.ops.append(op)
        if op in self.fail_at:
            raise decide.Invariant(f"injected failure at {op}", "test", {})

    # -- PowerShell
    def ps(self, script, timeout=900):
        if "Get-PartitionSupportedSize" in script and "ConvertTo-Json" in script:
            return json.dumps(self.facts)
        if script.startswith("Resize-Partition"):
            self.maybe_fail("shrink")
            self.c_size = int(re.search(r"-Size (\d+)", script).group(1))
            return ""
        if "$m = Get-PartitionSupportedSize" in script:
            self.maybe_fail("restore")
            wanted = int(re.search(r"-lt \[uint64\](\d+)", script).group(1))
            if self.c_size < wanted:
                self.c_size = min(wanted, self.facts["SizeMax"])
            return ""
        if "New-Partition" in script:
            self.maybe_fail("new-partition")
            size = int(re.search(r"-Size (\d+)", script).group(1))
            assert self.facts["Size"] - self.c_size >= size, "the model has no room for the partition"
            self.partitions.append(5)
            return json.dumps({"Number": 5, "Offset": 1048576, "Size": size, "Guid": "{99999999-8888-7777-6666-555555555555}"})
        if "Remove-Partition" in script:
            self.maybe_fail("remove-partition")
            self.partitions.remove(int(re.search(r"-PartitionNumber (\d+)", script).group(1)))
            return ""
        if "/S" in script and "mountvol" in script:
            self.maybe_fail("mount")
            self.mounted = True
            return json.dumps({"Root": str(self.esp) + "/", "Letter": "Z"})
        if "/D" in script and "mountvol" in script:
            self.maybe_fail("unmount")
            self.mounted = False
            return ""
        if "Get-Partition -DriveLetter" in script and "ConvertTo-Json" in script:
            self.maybe_fail("esp-info")
            return json.dumps(self.esp_part)
        raise AssertionError("an unexpected PowerShell script: " + script[:100])

    # -- bcdedit
    def bcd(self, *args):
        text = " ".join(args)
        if args[0] == "/copy":
            self.maybe_fail("bcd:copy")
            self.entries.add(ENTRY)
            return f"The entry was successfully copied to {ENTRY}."
        if args[:3] == ("/set", ENTRY, "path"):
            self.maybe_fail("bcd:path")
            assert ENTRY in self.entries
            return ""
        if text == f"/set {{fwbootmgr}} displayorder {ENTRY} /addlast":
            self.maybe_fail("bcd:displayorder-add")
            self.order.append(ENTRY)
            return ""
        if text == f"/set {{fwbootmgr}} displayorder {ENTRY} /remove":
            self.maybe_fail("bcd:displayorder-remove")
            self.order.remove(ENTRY)
            return ""
        if text == f"/set {{fwbootmgr}} bootsequence {ENTRY}":
            self.maybe_fail("bcd:sequence-set")
            self.sequence = ENTRY
            return ""
        if text == "/deletevalue {fwbootmgr} bootsequence":
            self.maybe_fail("bcd:sequence-clear")
            self.sequence = None
            return ""
        if text == f"/delete {ENTRY}":
            self.maybe_fail("bcd:delete")
            self.entries.remove(ENTRY)
            return ""
        if text == "/enum {fwbootmgr}":
            self.maybe_fail("bcd:enum")
            return f"bootsequence              {self.sequence}\n" if self.sequence and not self.hide_sequence else "displayorder\n"
        raise AssertionError("an unexpected bcdedit call: " + text)

    # -- shutdown
    def run_logged(self, command, **kwargs):
        assert os.path.basename(command[0]) == "shutdown", command
        if "/a" in command:
            self.ops.append("shutdown-abort")
            self.restart = "aborted"
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        self.ops.append("shutdown")
        if "shutdown" in self.fail_at:
            return SimpleNamespace(returncode=1, stdout="", stderr="no")
        self.restart = "scheduled"
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    # -- state
    def clean(self):
        """Is everything as it was before the conversion started?"""
        return (self.c_size == self.facts["Size"] and not self.partitions and not self.mounted and not self.entries
                and not self.order and self.sequence is None)

    def esp_files(self):
        return sorted(str(p.relative_to(self.esp)) for p in self.esp.rglob("*") if p.is_file())


class StageCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        self.iso = self.state / "fleet-installer.iso"
        self.iso_bytes = iso_fixture.build(iso_fixture.installer_tree(grub=b"GRUB-PROGRAM"))
        self.iso.write_bytes(self.iso_bytes)
        self.worlds = 0
        self.firmware_vars = {"BootOrder": (struct.pack("<2H", 0, 1), 7), "Boot0000": (b"windows", 7), "Boot0001": (b"other", 7)}
        self.says = []

    def world(self, **kw):
        """A fresh Windows (and a fresh download, as the CLI or wizard would have left it)."""
        self.worlds += 1
        folder = self.root / f"world{self.worlds}"
        folder.mkdir()
        if not self.iso.exists():
            self.iso.write_bytes(self.iso_bytes)
        world = World(folder, **kw)
        env = {"FLEET_WINDOWS_TARGET": str(world.disk), "FLEET_STATE": str(self.state), "FLEET_ARCH": "x86_64"}
        patches = [
            mock.patch.dict(os.environ, env),
            mock.patch.object(decide, "windows_ps", world.ps),
            mock.patch.object(decide, "bcd", world.bcd),
            mock.patch.object(decide, "run_logged", world.run_logged),
            mock.patch.object(decide, "windows_facts", lambda fresh=False: dict(world.facts)),
            mock.patch.object(decide.shutil, "which", lambda name, *a, **k: "bcdedit"),
            mock.patch.object(decide, "say", self.says.append),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        real = decide.shutil.disk_usage
        patch = mock.patch.object(decide.shutil, "disk_usage", lambda path: SimpleNamespace(total=1, used=1, free=world.free)
                                  if world.free is not None and str(path).startswith(str(world.esp)) else real(path))
        patch.start()
        self.addCleanup(patch.stop)
        return world

    def stage(self, world, firmware="auto", **kw):
        return decide.stage_windows("ci", str(self.iso), chosen={"path": "\\\\.\\PHYSICALDRIVE0"}, firmware=firmware, **kw)


class HappyPathTest(StageCase):
    def test_both_mechanisms_are_installed_and_verified_and_windows_stays_first(self):
        firmware = FakeFirmware(self.firmware_vars)
        world = self.world()
        self.assertEqual(self.stage(world, firmware), 0)
        self.assertEqual(world.restart, "scheduled")
        self.assertEqual(world.sequence, ENTRY)
        self.assertEqual(world.order, [ENTRY])
        self.assertEqual(world.esp_files(), ["EFI/BOOT/grub.cfg", "EFI/fleet/grubx64.efi"])
        self.assertEqual((world.esp / "EFI/fleet/grubx64.efi").read_bytes(), b"GRUB-PROGRAM")
        self.assertEqual(world.partitions, [5])
        self.assertTrue(world.c_size < world.facts["Size"])
        # BootOrder gained the new option at the END; BootNext chooses it; the option is the hand-checked layout.
        self.assertEqual(struct.unpack("<3H", firmware.vars["BootOrder"][0]), (0, 1, 2))
        self.assertEqual(firmware.vars["BootNext"][0], b"\x02\x00")
        self.assertEqual(firmware.vars["Boot0002"][0], decide.loader_load_option(world.esp_part, 512))
        self.assertEqual(world.ops[-1], "shutdown", "the restart is the very last thing")
        self.assertFalse(self.iso.exists(), "the installer's own downloaded copy is removed once it is safely written")

    def test_without_firmware_variables_the_bcdedit_layer_alone_is_enough(self):
        world = self.world()
        self.assertEqual(self.stage(world, None), 0)
        self.assertEqual(world.sequence, ENTRY)
        self.assertNotIn("esp-info", world.ops, "no firmware means no extra query")

    def test_a_download_somewhere_else_is_not_deleted(self):
        elsewhere = self.root / "Downloads"
        elsewhere.mkdir()
        mine = elsewhere / "fleet-installer.iso"
        mine.write_bytes(self.iso.read_bytes())
        world = self.world()
        self.assertEqual(decide.stage_windows("ci", str(mine), chosen={"path": "\\\\.\\PHYSICALDRIVE0"}, firmware=None), 0)
        self.assertTrue(mine.exists(), "a file the installer did not put there is never deleted")

    def test_an_arbitrary_name_in_the_state_folder_is_not_deleted_either(self):
        other = self.state / "my-notes.iso"
        other.write_bytes(self.iso.read_bytes())
        world = self.world()
        self.assertEqual(decide.stage_windows("ci", str(other), chosen={"path": "\\\\.\\PHYSICALDRIVE0"}, firmware=None), 0)
        self.assertTrue(other.exists())

    def test_the_cache_copy_of_the_wizard_is_removed(self):
        cache = self.root / "AppData" / "Local" / "fleet-installer"
        cache.mkdir(parents=True)
        mine = cache / "fleet-installer.iso"
        mine.write_bytes(self.iso.read_bytes())
        world = self.world()
        with mock.patch.dict(os.environ, {"FLEET_CACHE": str(cache)}):
            self.assertEqual(decide.stage_windows("ci", str(mine), chosen={"path": "\\\\.\\PHYSICALDRIVE0"}, firmware=None), 0)
        self.assertFalse(mine.exists())

    def test_the_copy_is_kept_if_the_install_is_taken_back(self):
        world = self.world()
        world.fail_at = {"shutdown"}
        with self.assertRaises(decide.Invariant):
            self.stage(world, FakeFirmware(self.firmware_vars))
        self.assertTrue(self.iso.exists(), "a failed run must leave the download for the retry")

    def test_the_boot_config_asks_for_ram_and_the_chosen_role(self):
        world = self.world()
        self.stage(world, None)
        config = (world.esp / "EFI/BOOT/grub.cfg").read_text()
        self.assertIn("fleet.role=ci", config)
        self.assertIn("copytoram", config)


class OneMechanismFailsTest(StageCase):
    BCD_STEPS = ("bcd:copy", "bcd:path", "bcd:displayorder-add", "bcd:sequence-set", "bcd:enum")

    def test_each_bcdedit_step_failing_is_survived_by_the_firmware_variables_and_leaves_no_bcd_entry(self):
        for step in self.BCD_STEPS:
            with self.subTest(step=step):
                firmware = FakeFirmware(self.firmware_vars)
                world = self.world()
                world.fail_at = {step}
                self.assertEqual(self.stage(world, firmware), 0, step)
                self.assertEqual((world.entries, world.order, world.sequence), (set(), [], None), "the half-made boot entry is taken back")
                self.assertEqual(firmware.vars["BootNext"][0], b"\x02\x00")
                self.assertEqual(world.restart, "scheduled")

    def test_a_firmware_that_does_not_show_the_sequence_counts_as_a_bcdedit_failure(self):
        firmware = FakeFirmware(self.firmware_vars)
        world = self.world()
        world.hide_sequence = True
        self.assertEqual(self.stage(world, firmware), 0)
        self.assertEqual((world.entries, world.order, world.sequence), (set(), [], None))

    def test_each_firmware_step_failing_is_survived_by_bcdedit_and_leaves_the_variables_as_they_were(self):
        steps = [("read", "BootOrder"), ("write", "Boot0002"), ("write", "BootOrder"), ("write", "BootNext"), ("read", "Boot0002")]
        for step in steps:
            with self.subTest(step=step):
                firmware = FakeFirmware(self.firmware_vars, fail={step})
                before = dict(firmware.vars)
                world = self.world()
                self.assertEqual(self.stage(world, firmware), 0, step)
                firmware.fail.clear()
                self.assertEqual(firmware.vars, before)
                self.assertEqual(world.sequence, ENTRY)
                self.assertEqual(world.restart, "scheduled")
                world.restart = None

    def test_firmware_that_silently_drops_a_write_is_caught_by_the_read_back(self):
        for lost in ("Boot0002", "BootNext"):
            with self.subTest(lost=lost):
                firmware = FakeFirmware(self.firmware_vars, lose={lost})
                world = self.world()
                self.assertEqual(self.stage(world, firmware), 0)
                self.assertNotIn("Boot0002", firmware.vars)
                self.assertEqual(firmware.vars["BootOrder"], self.firmware_vars["BootOrder"], "the boot order is put back")
                self.assertEqual(world.sequence, ENTRY)

    def test_the_wrong_efi_partition_disables_only_the_firmware_mechanism(self):
        firmware = FakeFirmware(self.firmware_vars)
        world = self.world()
        world.esp_part["DiskNumber"] = 1
        self.assertEqual(self.stage(world, firmware), 0)
        self.assertNotIn("BootNext", firmware.vars)
        self.assertEqual(world.sequence, ENTRY)

    def test_a_partition_the_query_cannot_describe_disables_only_the_firmware_mechanism(self):
        firmware = FakeFirmware(self.firmware_vars)
        world = self.world()
        world.esp_part.pop("Guid")
        self.assertEqual(self.stage(world, firmware), 0)
        self.assertEqual(firmware.vars, self.firmware_vars)


class NeitherMechanismTest(StageCase):
    def assert_everything_put_back(self, world, firmware=None, before=None):
        self.assertTrue(world.clean(), (world.c_size, world.partitions, world.mounted, world.entries, world.order, world.sequence))
        self.assertEqual(world.esp_files(), [], "no boot file may stay on the EFI system partition")
        self.assertNotEqual(world.restart, "scheduled")
        if firmware is not None:
            self.assertEqual(firmware.vars, before)
        self.assertTrue(self.iso.exists())

    def test_neither_verifying_stops_with_one_clear_message_and_puts_everything_back(self):
        firmware = FakeFirmware(self.firmware_vars, lose={"BootNext"})
        before = dict(firmware.vars)
        world = self.world()
        world.hide_sequence = True
        with self.assertRaises(decide.Invariant) as caught:
            self.stage(world, firmware)
        self.assertIn("one-time boot entry", caught.exception.what)
        self.assertIn("bcdedit", caught.exception.context["problems"])
        self.assertIn("firmware variables", caught.exception.context["problems"])
        self.assertIn("install USB", caught.exception.fix)
        self.assert_everything_put_back(world, firmware, before)

    def test_no_firmware_session_and_bcdedit_failing_is_neither(self):
        world = self.world()
        world.fail_at = {"bcd:sequence-set"}
        with self.assertRaises(decide.Invariant) as caught:
            self.stage(world, None)
        self.assertIn("not available in this session", caught.exception.context["problems"])
        self.assert_everything_put_back(world)

    def test_the_restart_refusing_to_schedule_undoes_both_mechanisms(self):
        firmware = FakeFirmware(self.firmware_vars)
        before = dict(firmware.vars)
        world = self.world()
        world.fail_at = {"shutdown"}
        with self.assertRaises(decide.Invariant):
            self.stage(world, firmware)
        self.assert_everything_put_back(world, firmware, before)

    def test_an_interruption_after_the_restart_is_scheduled_cancels_it_and_puts_everything_back(self):
        firmware = FakeFirmware(self.firmware_vars)
        before = dict(firmware.vars)
        world = self.world()
        real_log = decide.log

        def interrupted(message, level="INFO"):
            if "restart is scheduled" in message:
                raise KeyboardInterrupt()
            return real_log(message, level)

        with mock.patch.object(decide, "log", interrupted), self.assertRaises(KeyboardInterrupt):
            self.stage(world, firmware)
        self.assertEqual(world.restart, "aborted", "shutdown /a must run before anything is undone")
        self.assertLess(world.ops.index("shutdown-abort"), world.ops.index("bcd:delete"))
        self.assert_everything_put_back(world, firmware, before)

    def test_the_efi_partition_without_room_stops_before_a_byte_is_written_there(self):
        world = self.world()
        world.free = 1024
        with self.assertRaises(decide.Invariant) as caught:
            self.stage(world, FakeFirmware(self.firmware_vars))
        self.assertIn("too little free space", caught.exception.what)
        self.assertIn("install USB", caught.exception.fix)
        self.assertEqual(world.ops.count("bcd:copy"), 0)
        self.assert_everything_put_back(world)


class FailureAfterEachStepTest(StageCase):
    """Fail every operation in turn; the model must always come back to the start."""

    OPERATIONS = ("shrink", "new-partition", "mount", "bcd:copy", "bcd:path", "bcd:displayorder-add", "bcd:sequence-set",
                  "esp-info", "shutdown")

    def run_failing(self, op, firmware):
        world = self.world()
        world.fail_at = {op}
        try:
            result = self.stage(world, firmware)
        except decide.Invariant:
            result = "raised"
        return world, result

    def test_a_step_that_must_succeed_puts_everything_back_whatever_the_state(self):
        for op in ("shrink", "new-partition", "mount"):
            with self.subTest(op=op):
                firmware = FakeFirmware(self.firmware_vars)
                before = dict(firmware.vars)
                world, result = self.run_failing(op, firmware)
                self.assertEqual(result, "raised")
                self.assertTrue(world.clean(), (op, world.c_size, world.partitions, world.mounted))
                self.assertEqual(world.esp_files(), [])
                self.assertEqual(firmware.vars, before)
                self.assertNotEqual(world.restart, "scheduled")

    def test_a_failing_write_into_the_new_partition_puts_everything_back(self):
        world = self.world()

        def broken(*args, **kwargs):
            world.ops.append("write")
            raise decide.Invariant("the disk accepted a short write", "test", {})

        with self.assertRaises(decide.Invariant):
            decide.stage_windows("ci", str(self.iso), chosen={"path": "\\\\.\\PHYSICALDRIVE0"}, writer=broken, firmware=None)
        self.assertTrue(world.clean())
        self.assertNotIn("mount", world.ops, "the boot loader must not be placed before the image is proven")
        self.assertNotIn("bcd:copy", world.ops, "the firmware must not be touched before the image is proven")

    def test_every_undo_runs_newest_first(self):
        firmware = FakeFirmware(self.firmware_vars)
        world = self.world()
        world.fail_at = {"shutdown"}
        with self.assertRaises(decide.Invariant):
            self.stage(world, firmware)
        ops = world.ops
        order = [ops.index(name) for name in ("shrink", "new-partition", "mount", "bcd:copy", "shutdown")]
        self.assertEqual(order, sorted(order))
        undone = [name for name in ops[ops.index("shutdown"):] if name in ("bcd:sequence-clear", "bcd:displayorder-remove", "bcd:delete", "unmount", "remove-partition", "restore")]
        self.assertEqual(undone, ["bcd:sequence-clear", "bcd:displayorder-remove", "bcd:delete", "unmount", "remove-partition", "restore"])

    def test_an_undo_step_that_fails_is_reported_but_does_not_stop_the_rest(self):
        world = self.world()
        world.fail_at = {"shutdown", "bcd:delete", "bcd:displayorder-remove"}
        with self.assertRaises(decide.Invariant):
            self.stage(world, None)
        self.assertEqual(world.partitions, [], "the partition is still removed")
        self.assertEqual(world.c_size, world.facts["Size"], "C: is still given back its space")
        self.assertFalse(world.mounted)
        self.assertEqual(world.esp_files(), [])
        self.assertIn("Could not undo: delete the firmware boot entry", " ".join(self.says))
        self.assertEqual(world.entries, {ENTRY}, "what could not be undone is named for the person (see docs/windows.md)")


class RefusalsTest(StageCase):
    def test_too_little_ram_stops_before_anything_changes(self):
        world = self.world(facts={"Memory": 1 * 1024 ** 3})
        self.assertEqual(self.stage(world, None), 2)
        self.assertEqual(world.ops, [])
        self.assertIn("RAM", " ".join(self.says))
        self.assertIn("USB", " ".join(self.says))

    def test_a_shrink_that_became_impossible_after_the_download_is_refused_without_changes(self):
        world = self.world(facts={"SizeMin": C_SIZE - 1024})
        self.assertEqual(self.stage(world, None), 2)
        self.assertEqual(world.ops, [])

    def test_the_download_that_is_now_on_c_counts_as_used_space_in_the_new_measurement(self):
        # Before the download the same machine looked fine (the early check asks for the room twice);
        # afterwards SizeMin has grown by the size of the file, and the exact measurement decides.
        fits = decide.windows_need(self.iso.stat().st_size)
        world = self.world(facts={"SizeMin": C_SIZE - fits + 1})
        self.assertEqual(self.stage(world, None), 2)
        world2 = self.world(facts={"SizeMin": C_SIZE - fits - 1})
        self.assertEqual(self.stage(world2, None), 0)


class PreflightTest(unittest.TestCase):
    """The checks every in-place conversion runs before anyone is asked to confirm."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        (root / "efi").mkdir()
        (root / "kexec").write_text("#!/bin/sh\n")
        env = {"FLEET_EUID": "0", "FLEET_ARCH": "x86_64", "FLEET_EFI_DIR": str(root / "efi"), "FLEET_KEXEC": str(root / "kexec"),
               "FLEET_ISO_FS": "ext4", "FLEET_NODE_CONF": str(root / "none.conf"), "FLEET_NO_ENROLL": "1"}
        patch = mock.patch.dict(os.environ, env)
        patch.start()
        self.addCleanup(patch.stop)
        self.root = root

    def run_preflight(self, os_name, size, memory, **kw):
        probe = mock.patch.dict(decide.NET, {"probe": lambda: (None, size), "windows": lambda *a, **k: []}, clear=False)
        with probe, mock.patch.object(decide, "mem_total", return_value=memory):
            found = decide.preflight(os_name, "ci", "install", None, self.root, **kw)
        return {item["name"]: item for item in found}

    def test_linux_conversion_needs_the_image_plus_two_gib_of_ram(self):
        gib = 1024 ** 3
        short = self.run_preflight("Linux", 8 * gib, 10 * gib - 1)["memory"]
        self.assertEqual(short["status"], "fail")
        self.assertIn("10.0 GiB", short["detail"])
        self.assertIn("USB cannot help", short["fix"])
        self.assertIn("same image", short["fix"])
        self.assertEqual(self.run_preflight("Linux", 8 * gib, 10 * gib)["memory"]["status"], "ok")

    def test_it_is_no_longer_only_a_warning_at_one_and_a_half_times_the_image(self):
        gib = 1024 ** 3
        self.assertEqual(self.run_preflight("Linux", 8 * gib, 12 * gib)["memory"]["status"], "ok")
        self.assertEqual(self.run_preflight("Linux", 8 * gib, 9 * gib)["memory"]["status"], "fail", "1.5x of 8 GiB is 12; 9 GiB used to be a warning and is now a refusal")

    def test_unknown_memory_or_unknown_size_is_not_a_refusal(self):
        self.assertNotIn("memory", self.run_preflight("Linux", 8 * 1024 ** 3, None))
        self.assertNotIn("memory", self.run_preflight("Linux", None, 1))

    def test_an_install_usb_is_not_held_to_the_ram_rule(self):
        probe = mock.patch.dict(decide.NET, {"probe": lambda: (None, 8 * 1024 ** 3)}, clear=False)
        with probe, mock.patch.object(decide, "mem_total", return_value=1024 ** 3):
            found = {item["name"] for item in decide.preflight("Linux", None, "media", None, self.root)}
        self.assertNotIn("memory", found)

    def test_windows_that_is_not_elevated_stops_with_the_one_way_to_fix_it(self):
        with mock.patch.object(decide, "windows_admin", return_value=False):
            found = self.run_preflight("Windows", None, None)
        self.assertEqual(found["privilege"]["status"], "fail")
        self.assertIn("Run as administrator", found["privilege"]["fix"])
        with mock.patch.object(decide, "windows_admin", return_value=True):
            self.assertEqual(self.run_preflight("Windows", None, None)["privilege"]["status"], "ok")
        with mock.patch.object(decide, "windows_admin", return_value=None):
            self.assertEqual(self.run_preflight("Windows", None, None)["privilege"]["status"], "ok")
        with mock.patch.object(decide, "windows_admin", return_value=False):
            self.assertEqual(self.run_preflight("Windows", None, None, need_root=False)["privilege"]["status"], "info", "the wizard's review is not elevated yet")

    def test_the_installer_path_reaches_the_windows_check(self):
        seen = {}
        probe = mock.patch.dict(decide.NET, {"probe": lambda: (None, 5), "windows": lambda size, disk, strict, iso_path=None: seen.update(iso=iso_path) or []}, clear=False)
        with probe, mock.patch.object(decide, "mem_total", return_value=None), mock.patch.object(decide, "windows_admin", return_value=True):
            decide.preflight("Windows", "ci", "install", None, self.root, iso_path=self.root / "fleet-installer.iso")
        self.assertEqual(seen["iso"], self.root / "fleet-installer.iso")


class FindingsExtrasTest(unittest.TestCase):
    """The checks added for what real machines do."""

    def findings(self, iso_path=None, size=6 * 1024 ** 3, **changes):
        facts = {**FACTS, **changes}
        with mock.patch.object(decide, "windows_facts", return_value=facts), mock.patch.object(decide.shutil, "which", return_value="bcdedit"):
            return {item["name"]: item for item in decide.windows_findings(size, "\\\\.\\PHYSICALDRIVE0", iso_path=iso_path)}

    def test_a_dynamic_disk_odd_sectors_and_raid_are_each_named(self):
        self.assertEqual(self.findings(Dynamic=True)["dynamic-disk"]["status"], "fail")
        self.assertEqual(self.findings(LogicalSectorSize=1024)["sector-size"]["status"], "fail")
        raid = self.findings(BusType="RAID")["disk-controller"]
        self.assertEqual(raid["status"], "warn")
        self.assertIn("AHCI", raid["fix"])
        self.assertNotIn("disk-controller", self.findings())

    def test_4096_byte_sectors_are_accepted(self):
        self.assertNotIn("sector-size", self.findings(LogicalSectorSize=4096))

    def test_bitlocker_and_battery_are_warnings_with_the_thing_to_do(self):
        bitlocker = self.findings(BitLocker="On")["bitlocker"]
        self.assertEqual(bitlocker["status"], "warn")
        self.assertIn("recovery key", bitlocker["fix"])
        self.assertEqual(self.findings(BitLocker="Off").get("bitlocker"), None)
        self.assertEqual(self.findings(OnBattery=True)["power"]["status"], "warn")

    def test_the_room_for_the_download_is_asked_for_only_while_it_is_still_to_come(self):
        gib = 1024 ** 3
        tight = {"SizeMin": C_SIZE - 10 * gib}
        with tempfile.TemporaryDirectory() as tmp:
            future = Path(tmp) / "fleet-installer.iso"
            self.assertEqual(self.findings(iso_path=None, **tight)["shrink"]["status"], "ok", "no path: the plain measurement")
            refused = self.findings(iso_path=future, **tight)["shrink"]
            self.assertEqual(refused["status"], "fail")
            self.assertIn("including", refused["detail"])
            future.write_bytes(b"x")
            self.assertEqual(self.findings(iso_path=future, **tight)["shrink"]["status"], "ok", "once it is on C: the file is part of SizeMin already")

    def test_a_download_on_another_drive_costs_c_nothing(self):
        gib = 1024 ** 3
        with mock.patch.object(decide.os.path, "splitdrive", lambda path: ("D:", path)), mock.patch.object(decide.os.path, "abspath", lambda path: "D:" + str(path)):
            found = self.findings(iso_path="D:\\fleet-installer.iso", SizeMin=C_SIZE - 10 * gib)
        self.assertEqual(found["shrink"]["status"], "ok")

    def test_the_plan_names_every_step_and_the_sizes(self):
        lines = decide.windows_plan_lines({**FACTS}, 6 * 1024 ** 3, "web")
        text = "\n".join(lines)
        self.assertEqual(len(lines), 6)
        self.assertIn("Shrink C: from 500.0 GiB to 493.9 GiB", text)
        self.assertIn("gives up 6208 MiB", text)
        self.assertIn("6144 MiB partition of type Linux data on disk 0", text)
        self.assertIn("partition 1 of disk 0", text)
        self.assertIn("(web installer)", text)
        self.assertIn("ERASES the whole of disk 0", text)
        self.assertIn("installs web", text)


if __name__ == "__main__":
    unittest.main()
