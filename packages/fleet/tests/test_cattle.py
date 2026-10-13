import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("cattle", Path(__file__).parents[1] / "scripts/cattle.py")
cattle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cattle)


def disk(**changes):
    base = dict(path="/dev/nvme0n1", type="disk", tran="nvme", rm=False, hotplug=False, mountpoints=[None])
    base.update(changes)
    return base


class SelectDiskTests(unittest.TestCase):
    def test_prefers_nvme_and_lowest_by_path(self):
        disks = [
            disk(path="/dev/sda", tran="sata"),
            disk(path="/dev/nvme1n1"),
            disk(path="/dev/nvme0n1"),
            disk(path="/dev/vda", tran="virtio"),
        ]
        links = {
            "/dev/nvme1n1": ["/dev/disk/by-path/pci-0000:02:00.0-nvme-1"],
            "/dev/nvme0n1": ["/dev/disk/by-path/pci-0000:01:00.0-nvme-1"],
            "/dev/sda": ["/dev/disk/by-path/pci-0000:00:1f.2-ata-1"],
        }
        self.assertEqual(
            cattle.select_disk(disks, lambda path: links.get(path, [])),
            "/dev/disk/by-path/pci-0000:01:00.0-nvme-1",
        )

    def test_falls_back_to_sata_then_kernel_name(self):
        chosen = cattle.select_disk([disk(path="/dev/sda", tran="sata")], lambda _path: [])
        self.assertEqual(chosen, "/dev/sda")

    def test_skips_usb_removable_hotplug_and_mounted(self):
        bad = [
            disk(tran="usb"),
            disk(rm=True),
            disk(hotplug=1),
            disk(mountpoints=["/"]),
            disk(children=[dict(mountpoints=["/nix"], children=[])]),
            disk(type="part"),
        ]
        for candidate in bad:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                cattle.select_disk([candidate], lambda _path: [])

    def test_skips_mounted_and_keeps_the_blank_nvme(self):
        disks = [
            disk(path="/dev/vda", tran="virtio", mountpoints=["/"]),
            disk(path="/dev/nvme0n1"),
        ]
        self.assertEqual(cattle.select_disk(disks, lambda _path: []), "/dev/nvme0n1")


class IdentityTests(unittest.TestCase):
    def test_id_prefers_dmi_and_rejects_placeholders(self):
        mac = "aa:bb:cc:dd:ee:ff"
        self.assertEqual(cattle.stable_id("ABC-DEF", mac), cattle.stable_id("abc-def", None))
        self.assertNotEqual(cattle.stable_id("abc-def", None), cattle.stable_id(None, mac))
        for blank in ("", "none", "Not Present", "Not Settable", "00000000-0000-0000-0000-000000000000"):
            with self.subTest(blank=blank):
                self.assertEqual(cattle.stable_id(blank, mac), cattle.stable_id(None, mac))
        with self.assertRaises(ValueError):
            cattle.stable_id("none", None)

    def test_hostname_orders_gpu_then_highmem(self):
        self.assertEqual(cattle.hostname_for("ci", ["highmem", "gpu"], "7c21"), "ci-gpu-highmem-7c21")
        self.assertEqual(cattle.hostname_for("ci", [], "a3f9"), "ci-a3f9")
        self.assertEqual(cattle.runner_labels("x86_64", ["gpu", "highmem"]), ["x64", "gpu", "high-mem"])
        self.assertEqual(cattle.runner_labels("aarch64", []), ["arm64"])

    def test_high_mem_is_strictly_above_the_threshold(self):
        self.assertFalse(cattle.is_high_mem(32 * 1024, 60))
        self.assertFalse(cattle.is_high_mem(60 * 1024, 60))
        self.assertTrue(cattle.is_high_mem(63 * 1024, 60))

    def test_production_slot_counts(self):
        production = dict(reserve_gib=4, per_runner_gib=6, per_runner_cores=2, slot_max=8)
        self.assertEqual(cattle.slot_count(16, 32 * 1024, **production), 4)
        self.assertEqual(cattle.slot_count(16, 96 * 1024, **production), 8)
        self.assertEqual(cattle.slot_count(2, 8 * 1024, **production), 1)
        self.assertEqual(cattle.slot_count(0, 0, **production), 1)

    def test_qemu_core_id_zero_uses_the_online_count(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index in range(4):
                cpu = root / f"cpu{index}" / "topology"
                cpu.mkdir(parents=True)
                (cpu / "physical_package_id").write_text("0\n")
                (cpu / "core_id").write_text("0\n")
            self.assertEqual(cattle.physical_cores(temp), 4)
            (root / "cpu1" / "topology" / "core_id").write_text("1\n")
            (root / "cpu2" / "topology" / "core_id").write_text("2\n")
            (root / "cpu3" / "topology" / "core_id").write_text("3\n")
            self.assertEqual(cattle.physical_cores(temp), 4)

    def test_identity_files_and_ci_only_runner_state(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "etc/fleet/capabilities.d").mkdir(parents=True)
            (root / "etc/fleet/capabilities.d/gpu").write_text("gpu\n")
            conf = {
                "role": "ci",
                "high_mem_gib": "2",
                "reserve_gib": "0",
                "per_runner_gib": "1",
                "per_runner_cores": "2",
                "slot_max": "4",
            }
            names = []
            hostname = cattle.apply_identity(root, conf, "ab12", 4096, "x86_64", names.append, cores=4)
            self.assertEqual(hostname, "ci-gpu-highmem-ab12")
            self.assertEqual(names, ["ci-gpu-highmem-ab12"])
            node = (root / "run/fleet/node").read_text()
            self.assertIn("capabilities=gpu,highmem\n", node)
            self.assertEqual((root / "run/fleet/node").stat().st_mode & 0o777, 0o644)
            self.assertEqual((root / "run/fleet/slot-count").read_text(), "2\n")
            self.assertIn("ACTIONS_RUNNER_INPUT_NAME=ci-gpu-highmem-ab12\n", (root / "run/fleet/identity").read_text())
            conf["role"] = "web"
            cattle.apply_identity(root, conf, "ab12", 512, "x86_64", names.append, cores=2)
            self.assertFalse((root / "run/fleet/identity").exists())
            self.assertIn("hostname=web-gpu-ab12\n", (root / "run/fleet/node").read_text())


class CheckerTests(unittest.TestCase):
    def test_package_tree_is_cattle(self):
        self.assertEqual(cattle.check_tree(Path(__file__).parents[1]), [])

    def test_flags_pets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "hosts").mkdir()
            (root / "hosts/node1.nix").write_text("{ }\n")
            (root / "profiles").mkdir()
            (root / "profiles/ms-a2.nix").write_text("{ }\n")
            (root / "hardware-configuration.nix").write_text(
                '{ networking.hostName = "pet"; }\n'
            )
            (root / "bad.nix").write_text(
                'disk = "/dev/nvme0n1";\n'
                'mac = "aa:bb:cc:dd:ee:ff";\n'
            )
            (root / "ok.nix").write_text('{ device = "/dev/fleet-install-disk"; networking.hostName = ""; }\n')
            errors = "\n".join(cattle.check_tree(root))
            self.assertIn("per-machine host file", errors)
            self.assertIn("profiles/", errors)
            self.assertIn("hardware-configuration.nix", errors)
            self.assertIn("hardcoded NVMe kernel path", errors)
            self.assertIn("hardcoded MAC address", errors)
            self.assertIn("static hostname", errors)
            self.assertNotIn("ok.nix", errors)


if __name__ == "__main__":
    unittest.main()
