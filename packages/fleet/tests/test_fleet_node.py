#!/usr/bin/env python3
"""The one downloaded file installs or refuses a node. No Nix, no checkout."""

import base64
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "fleet-node.sh"
DECIDE = ROOT / "scripts" / "decide.py"
PLAIN = "internal NVMe, 2.0 TB, Samsung SSD 980"
USB_PLAIN = "USB disk, 8.0 GB, Flash"
SECTOR = 2048


def _dirent(iso_ident, extent, size, is_dir, rr_name=None):
    """One ISO9660 directory record. Rock Ridge NM is the name the reader must use."""
    if iso_ident == ".":
        ident = b"\x00"
    elif iso_ident == "..":
        ident = b"\x01"
    else:
        ident = iso_ident.encode("ascii")
    name_len = len(ident)
    su = b""
    if rr_name is not None:
        encoded = rr_name.encode("ascii")
        su = b"NM" + bytes([5 + len(encoded), 1, 0]) + encoded
    su_off = 33 + name_len + (1 if name_len % 2 == 0 else 0)
    record = bytearray(su_off + len(su))
    record[0] = len(record)
    record[2:6] = extent.to_bytes(4, "little")
    record[6:10] = extent.to_bytes(4, "big")
    record[10:14] = size.to_bytes(4, "little")
    record[14:18] = size.to_bytes(4, "big")
    record[25] = 2 if is_dir else 0
    record[32] = name_len
    record[33:33 + name_len] = ident
    if su:
        record[su_off:] = su
    return bytes(record)


def installer_iso_bytes():
    """A tiny ISO9660 image whose boot files are visible only through Rock Ridge."""
    cfg = "\n".join([
        "DEFAULT boot",
        "LABEL boot",
        "LINUX /boot/bzImage",
        "APPEND init=/nix/store/fleet/init fleet.role=ci",
        "INITRD /boot/initrd",
        "LABEL boot-web",
        "LINUX /boot/bzImage",
        "APPEND init=/nix/store/fleet/init fleet.role=web",
        "INITRD /boot/initrd",
        "LABEL boot-cache",
        "LINUX /boot/bzImage",
        "APPEND init=/nix/store/fleet/init fleet.role=cache",
        "INITRD /boot/initrd",
        "LABEL boot-netboot",
        "LINUX /boot/bzImage",
        "APPEND init=/nix/store/fleet/init fleet.role=netboot",
        "INITRD /boot/initrd",
        "LABEL boot-devbox",
        "LINUX /boot/bzImage",
        "APPEND init=/nix/store/fleet/init fleet.role=devbox",
        "INITRD /boot/initrd",
        "LABEL boot-copytoram",
        "LINUX /boot/bzImage",
        "APPEND init=/nix/store/fleet/init fleet.role=ci copytoram",
        "INITRD /boot/initrd",
        "",
    ]).encode()
    kernel = b"kernel-bytes\n"
    initrd = b"initrd-bytes\n"
    kernel_rec = _dirent("KERNEL", 22, len(kernel), False, "bzImage")
    initrd_rec = _dirent("INITRD", 23, len(initrd), False, "initrd")
    boot_len = 34 + 34 + len(kernel_rec) + len(initrd_rec)
    boot = b"".join([
        _dirent(".", 20, boot_len, True),
        _dirent("..", 18, 0, True),
        kernel_rec,
        initrd_rec,
    ])
    cfg_rec = _dirent("ISOCFG", 21, len(cfg), False, "isolinux.cfg")
    iso_len = 34 + 34 + len(cfg_rec)
    isolinux = b"".join([
        _dirent(".", 19, iso_len, True),
        _dirent("..", 18, 0, True),
        cfg_rec,
    ])
    boot_dir = _dirent("BOOT", 20, len(boot), True, "boot")
    iso_dir = _dirent("ISOLINUX", 19, len(isolinux), True, "isolinux")
    root_len = 34 + 34 + len(iso_dir) + len(boot_dir)
    root = b"".join([
        _dirent(".", 18, root_len, True),
        _dirent("..", 18, root_len, True),
        iso_dir,
        boot_dir,
    ])
    image = bytearray(24 * SECTOR)
    pvd = bytearray(SECTOR)
    pvd[0] = 1
    pvd[1:6] = b"CD001"
    pvd[6] = 1
    pvd[128:130] = (SECTOR).to_bytes(2, "little")
    pvd[130:132] = (SECTOR).to_bytes(2, "big")
    root_rec = _dirent(".", 18, len(root), True)
    pvd[156:156 + len(root_rec)] = root_rec
    image[16 * SECTOR:(17 * SECTOR)] = pvd
    term = bytearray(SECTOR)
    term[0] = 255
    term[1:6] = b"CD001"
    term[6] = 1
    image[17 * SECTOR:(18 * SECTOR)] = term
    image[18 * SECTOR:18 * SECTOR + len(root)] = root
    image[19 * SECTOR:19 * SECTOR + len(isolinux)] = isolinux
    image[20 * SECTOR:20 * SECTOR + len(boot)] = boot
    image[21 * SECTOR:21 * SECTOR + len(cfg)] = cfg
    image[22 * SECTOR:22 * SECTOR + len(kernel)] = kernel
    image[23 * SECTOR:23 * SECTOR + len(initrd)] = initrd
    return bytes(image)


ISO_BYTES = installer_iso_bytes()


def write_executable(path, body):
    path.write_text(textwrap.dedent(body).lstrip("\n"))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def confirm_line(role, plain=PLAIN):
    return f"{role}: {plain}\n"


class NodeEntryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.state = self.root / "state"
        self.state.mkdir()
        self.iso = self.root / "fixture.iso"
        self.iso.write_bytes(ISO_BYTES)
        self.digest = hashlib.sha256(ISO_BYTES).hexdigest()
        self.curl_log = self.root / "curl"
        self.boot_log = self.root / "boot"
        self.dd_log = self.root / "dd"
        self.git_log = self.root / "git"
        self.nix_log = self.root / "nix"
        self.curl_mode = self.root / "curl-mode"
        self.curl_mode.write_text("ok")
        self.lookup = self.root / "lookup"
        self._lookup("ci")
        self.efi = self.root / "efi"
        self.efi.mkdir()
        write_executable(self.bin / "curl", f"""\
            #!/bin/bash
            out=""
            prev=""
            for arg in "$@"; do
              if [ "$prev" = "-o" ]; then out=$arg; fi
              prev=$arg
            done
            url=${{@: -1}}
            printf '%s\\n' "$url" >> {self.curl_log}
            mode=$(cat {self.curl_mode})
            if [ "$mode" = "fail" ]; then echo 'curl: (22) The requested URL returned error: 404' >&2; exit 22; fi
            case "$url" in
              */sys/wrapping/lookup)
                if [ "$mode" = "bad-token" ]; then echo 'curl: (22) The requested URL returned error: 400' >&2; exit 22; fi
                cp {self.lookup} "$out"
                exit 0
                ;;
            esac
            if [ "$mode" = "expire" ]; then printf 'Artifact has expired\\n' > "$out"; exit 0; fi
            case "$url" in
              *.sha256)
                if [ "$mode" = "bad-sum" ]; then
                  printf '0000000000000000000000000000000000000000000000000000000000000000  fleet-installer.iso\\n' > "$out"
                else
                  printf '{self.digest}  fleet-installer.iso\\n' > "$out"
                fi
                ;;
              *) cp {self.iso} "$out" ;;
            esac
            """)
        write_executable(self.bin / "kexec", f"""\
            #!/bin/bash
            printf '%s\\n' "$*" >> {self.boot_log}
            """)
        write_executable(self.bin / "dd", f"""\
            #!/bin/bash
            printf '%s\\n' "$*" >> {self.dd_log}
            """)
        write_executable(self.bin / "git", f"""\
            #!/bin/bash
            printf '%s\\n' "$*" >> {self.git_log}
            exit 99
            """)
        write_executable(self.bin / "nix", f"""\
            #!/bin/bash
            printf '%s\\n' "$*" >> {self.nix_log}
            exit 99
            """)
        write_executable(self.bin / "lsblk", f"""\
            #!/bin/bash
            cat {self.root}/linux.json
            """)
        write_executable(self.bin / "diskutil", f"""\
            #!/bin/bash
            if [ "$1" = "list" ]; then cat {self.root}/darwin-list; exit 0; fi
            name=$(basename "$2")
            cat {self.root}/"info-$name"
            """)
        strip = self.root / "strip-volumes.py"
        strip.write_text(
            "import json, sys\n"
            "raw = json.load(open(sys.argv[1], encoding='utf-8'))\n"
            "rows = raw if isinstance(raw, list) else [raw]\n"
            "for row in rows:\n"
            "    row.pop('Volumes', None)\n"
            "    row.pop('volumes', None)\n"
            "json.dump(rows, sys.stdout)\n"
        )
        write_executable(self.bin / "powershell", f"""\
            #!/bin/bash
            printf '%s\\n' "$*" > {self.root}/powershell-cmd
            cmd="$*"
            if [[ "$cmd" == *Win32_LogicalDisk* && "$cmd" == *Get-CimAssociatedInstance* && "$cmd" != *'Mounted=$false'* ]]; then
              cat {self.root}/windows.json
              exit 0
            fi
            python3 {strip} {self.root}/windows.json
            """)
        self._write_scenario("happy")
        self.env = os.environ.copy()
        self.env.update({
            "PATH": f"{self.bin}:{os.environ.get('PATH', '')}",
            "FLEET_STATE": str(self.state),
            "FLEET_CURL": str(self.bin / "curl"),
            "FLEET_LSBLK": str(self.bin / "lsblk"),
            "FLEET_DISKUTIL": str(self.bin / "diskutil"),
            "FLEET_POWERSHELL": str(self.bin / "powershell"),
            "FLEET_KEXEC": str(self.bin / "kexec"),
            "FLEET_DARWIN_BOOT": str(self.bin / "kexec"),
            "FLEET_WINDOWS_BOOT": str(self.bin / "kexec"),
            "FLEET_DD": str(self.bin / "dd"),
            "FLEET_INSTALLER_URL": "https://fixture.example/fleet-installer.iso",
            "FLEET_INSTALLER_SHA256_URL": "https://fixture.example/fleet-installer.iso.sha256",
            "FLEET_OS": "Linux",
            "FLEET_ARCH": "x86_64",
            "FLEET_EUID": "0",
            "FLEET_EFI_DIR": str(self.efi),
            "FLEET_CONFIRM_TIMEOUT": "5",
            "FLEET_ISO_FS": "ext4",
        })

    def tearDown(self):
        self.tmp.cleanup()

    def _lookup(self, role):
        self.lookup.write_text(json.dumps({"data": {"creation_path": f"secret/data/fleet/{role}", "creation_ttl": 3600}}))

    def _linux(self, disks):
        (self.root / "linux.json").write_text(json.dumps({"blockdevices": disks}))

    def _darwin(self, rows):
        lines = []
        for row in rows:
            node = row["node"]
            lines.append(f"{node} ({row['kind']}):")
            (self.root / f"info-{Path(node).name}").write_text(row["info"])
        (self.root / "darwin-list").write_text("\n".join(lines) + "\n")

    def _windows(self, rows):
        (self.root / "windows.json").write_text(json.dumps(rows))

    def _disk(self, kind):
        """One logical disk described the way each operating system lists it."""
        if kind == "internal":
            linux = {
                "path": "/dev/nvme0n1", "type": "disk", "tran": "nvme", "rm": False,
                "hotplug": False, "size": 2000000000000, "model": "Samsung SSD 980",
                "serial": "S5", "mountpoints": [None],
            }
            darwin = {
                "node": "/dev/disk0", "kind": "internal, physical",
                "info": textwrap.dedent("""\
                    Device Node: /dev/disk0
                    Protocol: PCI-Express
                    Internal: Yes
                    Whole: Yes
                    Removable Media: No
                    Device Location: Internal
                    Mounted: No
                    Device / Media Name: Samsung SSD 980
                    Disk Size: 2.0 TB (2000000000000 Bytes)
                    Serial Number: S5
                    Virtual: No
                    """),
            }
            windows = {
                "DeviceID": r"\\.\PHYSICALDRIVE0", "Model": "Samsung SSD 980",
                "Size": 2000000000000, "InterfaceType": "SCSI", "BusType": "NVMe",
                "MediaType": "Fixed hard disk media", "PNPDeviceID": "SCSI\\DISK",
                "SerialNumber": "S5", "Volumes": [], "Hotplug": False,
            }
        elif kind == "usb":
            linux = {
                "path": "/dev/sdb", "type": "disk", "tran": "usb", "rm": True,
                "hotplug": True, "size": 8000000000, "model": "Flash",
                "serial": "U1", "mountpoints": [None],
            }
            darwin = {
                "node": "/dev/disk4", "kind": "external, physical",
                "info": textwrap.dedent("""\
                    Device Node: /dev/disk4
                    Protocol: USB
                    Internal: No
                    Whole: Yes
                    Removable Media: Yes
                    Device Location: External
                    Mounted: No
                    Device / Media Name: Flash
                    Disk Size: 8.0 GB (8000000000 Bytes)
                    Serial Number: U1
                    Virtual: No
                    """),
            }
            windows = {
                "DeviceID": r"\\.\PHYSICALDRIVE1", "Model": "Flash",
                "Size": 8000000000, "InterfaceType": "USB", "BusType": "USB",
                "MediaType": "Removable Media", "PNPDeviceID": "USBSTOR\\DISK",
                "SerialNumber": "U1", "Volumes": [], "Hotplug": True,
            }
        elif kind == "second":
            linux = {
                "path": "/dev/nvme1n1", "type": "disk", "tran": "nvme", "rm": False,
                "hotplug": False, "size": 2000000000000, "model": "Samsung SSD 980",
                "serial": "S6", "mountpoints": [None],
            }
            darwin = {
                "node": "/dev/disk1", "kind": "internal, physical",
                "info": textwrap.dedent("""\
                    Device Node: /dev/disk1
                    Protocol: PCI-Express
                    Internal: Yes
                    Whole: Yes
                    Removable Media: No
                    Device Location: Internal
                    Mounted: No
                    Device / Media Name: Samsung SSD 980
                    Disk Size: 2.0 TB (2000000000000 Bytes)
                    Serial Number: S6
                    Virtual: No
                    """),
            }
            windows = {
                "DeviceID": r"\\.\PHYSICALDRIVE2", "Model": "Samsung SSD 980",
                "Size": 2000000000000, "InterfaceType": "SCSI", "BusType": "NVMe",
                "MediaType": "Fixed hard disk media", "PNPDeviceID": "SCSI\\DISK2",
                "SerialNumber": "S6", "Volumes": [], "Hotplug": False,
            }
        elif kind == "mounted":
            linux = {
                "path": "/dev/nvme0n1", "type": "disk", "tran": "nvme", "rm": False,
                "hotplug": False, "size": 2000000000000, "model": "Samsung SSD 980",
                "serial": "S5", "mountpoints": [None],
                "children": [{"type": "part", "mountpoints": ["/"]}],
            }
            darwin = {
                "node": "/dev/disk0", "kind": "internal, physical",
                "info": textwrap.dedent("""\
                    Device Node: /dev/disk0
                    Protocol: PCI-Express
                    Internal: Yes
                    Whole: Yes
                    Removable Media: No
                    Device Location: Internal
                    Mounted: Yes
                    Device / Media Name: Samsung SSD 980
                    Disk Size: 2.0 TB (2000000000000 Bytes)
                    Serial Number: S5
                    Virtual: No
                    """),
            }
            windows = {
                "DeviceID": r"\\.\PHYSICALDRIVE0", "Model": "Samsung SSD 980",
                "Size": 2000000000000, "InterfaceType": "SCSI", "BusType": "NVMe",
                "MediaType": "Fixed hard disk media", "PNPDeviceID": "SCSI\\DISK",
                "SerialNumber": "S5", "Volumes": ["C:"], "Hotplug": False,
            }
        elif kind == "hotplug":
            linux = {
                "path": "/dev/nvme0n1", "type": "disk", "tran": "nvme", "rm": False,
                "hotplug": True, "size": 2000000000000, "model": "Samsung SSD 980",
                "serial": "S5", "mountpoints": [None],
            }
            darwin = {
                "node": "/dev/disk0", "kind": "internal, physical",
                "info": textwrap.dedent("""\
                    Device Node: /dev/disk0
                    Protocol: PCI-Express
                    Internal: Yes
                    Whole: Yes
                    Removable Media: No
                    Hotplug: Yes
                    Device Location: Internal
                    Mounted: No
                    Device / Media Name: Samsung SSD 980
                    Disk Size: 2.0 TB (2000000000000 Bytes)
                    Serial Number: S5
                    Virtual: No
                    """),
            }
            windows = {
                "DeviceID": r"\\.\PHYSICALDRIVE0", "Model": "Samsung SSD 980",
                "Size": 2000000000000, "InterfaceType": "SCSI", "BusType": "NVMe",
                "MediaType": "Fixed hard disk media", "PNPDeviceID": "SCSI\\DISK",
                "SerialNumber": "S5", "Volumes": [], "Hotplug": True,
            }
        elif kind == "removable":
            linux = {
                "path": "/dev/nvme0n1", "type": "disk", "tran": "nvme", "rm": True,
                "hotplug": False, "size": 2000000000000, "model": "Samsung SSD 980",
                "serial": "S5", "mountpoints": [None],
            }
            darwin = {
                "node": "/dev/disk0", "kind": "internal, physical",
                "info": textwrap.dedent("""\
                    Device Node: /dev/disk0
                    Protocol: PCI-Express
                    Internal: Yes
                    Whole: Yes
                    Removable Media: Yes
                    Device Location: Internal
                    Mounted: No
                    Device / Media Name: Samsung SSD 980
                    Disk Size: 2.0 TB (2000000000000 Bytes)
                    Serial Number: S5
                    Virtual: No
                    """),
            }
            windows = {
                "DeviceID": r"\\.\PHYSICALDRIVE0", "Model": "Samsung SSD 980",
                "Size": 2000000000000, "InterfaceType": "SCSI", "BusType": "NVMe",
                "MediaType": "Removable Media", "PNPDeviceID": "SCSI\\DISK",
                "SerialNumber": "S5", "Volumes": [], "Hotplug": False,
            }
        else:
            raise AssertionError(kind)
        return linux, darwin, windows

    def _write_scenario(self, name):
        kinds = {
            "happy": ["internal", "usb"],
            "usb-only": ["usb"],
            "internal-only": ["internal"],
            "ambiguous": ["internal", "second"],
            "mounted": ["mounted"],
            "hotplug": ["hotplug"],
            "removable": ["removable"],
        }[name]
        linux, darwin, windows = [], [], []
        for kind in kinds:
            lin, dar, win = self._disk(kind)
            linux.append(lin)
            darwin.append(dar)
            windows.append(win)
        self._linux(linux)
        self._darwin(darwin)
        self._windows(windows)

    def run_entry(self, args, typed="", env=None, timeout=15):
        result = subprocess.run(
            [str(SCRIPT), *args],
            input=typed,
            capture_output=True,
            text=True,
            env=env or self.env,
            cwd=self.root,
            timeout=timeout,
            check=False,
        )
        return result

    def combined(self, result):
        return result.stdout + result.stderr

    def assert_one_next(self, text):
        lines = [line for line in text.splitlines() if line.startswith("Next:")]
        self.assertEqual(lines, [lines[0]] if lines else [], text)
        self.assertEqual(len(lines), 1, text)
        self.assertIn("Nothing was written", lines[0])

    def assert_no_secrets(self, text):
        self.assertNotIn("AGE-SECRET-KEY", text)
        self.assertNotIn("age-secret-key", text.lower())

    # ---- doctor, fail-fast, logs, status, guide -------------------------------

    def logs(self):
        return sorted((self.state / "logs").glob("fleet-node-*.log"))

    def test_doctor_is_read_only_and_names_the_disk_for_an_agent(self):
        result = self.run_entry(["doctor", "ci", "--json"])
        self.assertEqual(result.returncode, 0, self.combined(result))
        report = json.loads(result.stdout)
        self.assertTrue(report["ok"])
        self.assertEqual(report["erases"], PLAIN)
        self.assertEqual(report["confirm"], f"ci: {PLAIN}")
        self.assertEqual({c["name"] for c in report["checks"]} >= {"privilege", "architecture", "firmware", "boot-tool", "network", "disk"}, True)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse(self.dd_log.exists())
        self.assertFalse((self.state / "installed").exists())
        self.assertFalse((self.state / "fleet-installer.iso").exists())

    def test_doctor_reports_every_problem_at_once_with_one_next_line(self):
        env = self.env.copy()
        env.update({"FLEET_EUID": "1000", "FLEET_ARCH": "arm64", "FLEET_EFI_DIR": str(self.root / "nope")})
        self.curl_mode.write_text("fail")
        result = self.run_entry(["doctor", "ci"], "", env)
        text = self.combined(result)
        self.assertEqual(result.returncode, 2, text)
        for name in ("privilege", "architecture", "firmware", "network"):
            self.assertRegex(text, rf"FAIL\s+{name}")
        self.assertIn("returned error: 404", text)
        self.assertIn("Result: NOT ready, 4 problems", text)
        self.assert_one_next(text)
        self.assertIn("Log: ", text)
        self.assertFalse(self.boot_log.exists())

    def test_install_stops_before_the_prompt_when_a_check_fails_even_with_yes(self):
        env = self.env.copy()
        env["FLEET_ARCH"] = "arm64"
        result = self.run_entry(["ci", "--yes"], "", env)
        text = self.combined(result)
        self.assertEqual(result.returncode, 2, text)
        self.assertRegex(text, r"FAIL\s+architecture")
        self.assertNotIn("Type this line exactly", text)
        self.assertNotIn("FLEET-WIPE", text)
        self.assert_one_next(text)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse((self.state / "fleet-installer.iso").exists())

    def test_a_missing_release_fails_before_anyone_is_asked_to_confirm(self):
        self.curl_mode.write_text("fail")
        result = self.run_entry(["ci"], confirm_line("ci"))
        text = self.combined(result)
        self.assertNotEqual(result.returncode, 0, text)
        self.assertRegex(text, r"FAIL\s+network")
        self.assertNotIn("Type this line exactly", text)
        self.assert_one_next(text)

    def test_a_token_for_another_role_is_refused_before_the_prompt(self):
        token = self.root / "token"
        token.write_text("hvs.CAESIwrapped\n")
        self._lookup("web")
        result = self.run_entry(["ci", "--yes", "--token-file", str(token)], "")
        text = self.combined(result)
        self.assertEqual(result.returncode, 2, text)
        self.assertIn("secret/data/fleet/web", text)
        self.assertIn("just enroll ci", text)
        self.assertFalse(self.boot_log.exists())

    def test_a_spent_token_is_refused_before_the_prompt(self):
        token = self.root / "token"
        token.write_text("hvs.CAESIwrapped\n")
        self.curl_mode.write_text("bad-token")
        result = self.run_entry(["ci", "--yes", "--token-file", str(token)], "")
        text = self.combined(result)
        self.assertEqual(result.returncode, 2, text)
        self.assertIn("spent, expired", text)
        self.assertFalse(self.boot_log.exists())

    def test_checking_a_token_never_spends_it(self):
        token = self.root / "token"
        token.write_text("hvs.CAESIwrapped\n")
        result = self.run_entry(["doctor", "ci", "--token-file", str(token)])
        self.assertEqual(result.returncode, 0, self.combined(result))
        urls = self.curl_log.read_text()
        self.assertIn("/v1/sys/wrapping/lookup", urls)
        self.assertNotIn("/unwrap", urls)

    def test_no_token_is_a_loud_warning_not_a_block(self):
        result = self.run_entry(["doctor", "ci"])
        text = self.combined(result)
        self.assertEqual(result.returncode, 0, text)
        self.assertRegex(text, r"WARN\s+enrollment")
        self.assertIn("just enroll ci", text)

    def test_every_run_leaves_a_timestamped_log_without_secrets(self):
        token = self.root / "token"
        token.write_text("hvs.CAESIwrapped\n")
        result = self.run_entry(["ci", "--yes", "--token-file", str(token)], "")
        self.assertEqual(result.returncode, 0, self.combined(result))
        logs = self.logs()
        self.assertEqual(len(logs), 1)
        body = logs[0].read_text()
        self.assertRegex(body, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ INFO ", )
        self.assertIn("rebooting into the installer", body)
        self.assertIn("finished with exit code 0", body)
        self.assertNotIn("hvs.CAESIwrapped", body)
        self.assertNotIn("hvs.CAESIwrapped", self.combined(result))
        self.assertEqual(oct(logs[0].stat().st_mode & 0o777), "0o600")

    def test_a_failure_prints_the_log_path_and_the_log_says_why(self):
        self.curl_mode.write_text("fail")
        result = self.run_entry(["fetch", str(self.root / "out.iso")])
        text = self.combined(result)
        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(text, r"Why: .*returned error: 404")
        logs = self.logs()
        self.assertEqual(len(logs), 1)
        self.assertIn(f"Log: {logs[0]}", text)
        self.assertIn("exit 22", logs[0].read_text())

    def test_only_the_newest_logs_are_kept(self):
        logs = self.state / "logs"
        logs.mkdir()
        for index in range(30):
            (logs / f"fleet-node-20200101T0000{index:02d}Z-1.log").write_text("old\n")
        self.run_entry(["doctor", "ci"])
        self.assertLessEqual(len(self.logs()), 20)
        self.assertTrue(any("doctor" in path.read_text() for path in self.logs()))

    def test_vault_address_override_reaches_the_installer(self):
        token = self.root / "token"
        token.write_text("hvs.CAESIwrapped\n")
        env = self.env.copy()
        env["FLEET_VAULT_ADDR"] = "https://vault.example"
        result = self.run_entry(["ci", "--yes", "--token-file", str(token)], "", env)
        self.assertEqual(result.returncode, 0, self.combined(result))
        self.assertIn("https://vault.example/v1/sys/wrapping/lookup", self.curl_log.read_text())
        self.assertIn("fleet.vault=https://vault.example", self.boot_log.read_text())

    def _node(self, failed="", timer="active", revision="0123456789abcdef"):
        conf = self.root / "node.conf"
        conf.write_text("role=ci\n")
        rev = self.root / "revision"
        rev.write_text(revision + "\n")
        write_executable(self.bin / "systemctl", f"""\
            #!/bin/bash
            case "$1" in
              is-active) echo {timer}; [ {timer} = active ] ;;
              --failed) printf '{failed}' ;;
            esac
            """)
        env = self.env.copy()
        env.update({
            "FLEET_NODE_CONF": str(conf),
            "FLEET_REVISION": str(rev),
            "FLEET_SYSTEMCTL": str(self.bin / "systemctl"),
            "FLEET_HOSTNAME": "ci-a3f9",
            "FLEET_HEALTH_FAILURE": str(self.root / "no-health-failure"),
        })
        return env

    def test_status_of_a_healthy_node(self):
        result = self.run_entry(["status"], "", self._node())
        text = self.combined(result)
        self.assertEqual(result.returncode, 0, text)
        self.assertIn("ci-a3f9", text)
        self.assertIn("0123456789ab", text)
        self.assertIn("Result: healthy.", text)

    def test_status_names_the_first_problem(self):
        env = self._node(failed="fleet-sync.service loaded failed failed Pull\\n", timer="inactive")
        (self.root / "no-health-failure").write_text("cache unreachable\n")
        env["FLEET_HEALTH_FAILURE"] = str(self.root / "no-health-failure")
        result = self.run_entry(["status"], "", env)
        text = self.combined(result)
        self.assertEqual(result.returncode, 1, text)
        self.assertRegex(text, r"FAIL\s+last-sync")
        self.assertRegex(text, r"FAIL\s+sync-timer")
        self.assertIn("failed: fleet-sync.service", text)
        self.assertEqual(len([l for l in text.splitlines() if l.startswith("Next:")]), 1, text)

    def test_status_of_a_machine_that_is_not_a_node(self):
        env = self.env.copy()
        env["FLEET_NODE_CONF"] = str(self.root / "missing.conf")
        result = self.run_entry(["status"], "", env)
        self.assertEqual(result.returncode, 1)
        self.assertIn("not an installed fleet node", self.combined(result))

    def test_the_guide_travels_inside_the_single_file(self):
        alone = self.root / "alone"
        alone.mkdir()
        target = alone / "fleet-node.sh"
        target.write_bytes(SCRIPT.read_bytes())
        result = subprocess.run(["bash", str(target), "guide"], capture_output=True, text=True, cwd=alone, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, (ROOT / "docs" / "agent-install.md").read_text())
        self.assertIn("doctor ROLE --json", result.stdout)

    def test_help_lists_the_commands_and_the_runbook_url(self):
        result = self.run_entry(["help"])
        self.assertEqual(result.returncode, 0)
        for word in ("doctor", "status", "remove", "flash", "guide", "agent-install.md"):
            self.assertIn(word, result.stdout)

    def test_a_corrupt_state_marker_stops_the_program_instead_of_being_guessed_at(self):
        for corrupt in ("role=toaster\nstatus=installed\n", "garbage\n", "role=ci\n"):
            with self.subTest(corrupt=corrupt):
                (self.state / "installed").write_text(corrupt)
                self.boot_log.unlink(missing_ok=True)
                result = self.run_entry(["ci", "--yes"], "")
                text = self.combined(result)
                self.assertEqual(result.returncode, 71, text)
                self.assertIn("FLEET-INVARIANT state marker installed", text)
                self.assertIn(str(self.state / "installed"), text)
                self.assertIn("delete that file", text)
                self.assertIn("Log: ", text)
                self.assertNotIn("FLEET-WIPE", text)
                self.assertFalse(self.boot_log.exists())

    def test_an_invariant_never_leaks_a_secret_into_the_output_or_the_log(self):
        (self.state / "installed").write_text("role=hvs.SECRETTOKEN123\nstatus=installed\n")
        result = self.run_entry(["ci", "--yes"], "")
        self.assertEqual(result.returncode, 71, self.combined(result))
        self.assertNotIn("SECRETTOKEN123", self.combined(result))
        for log in self.logs():
            self.assertNotIn("SECRETTOKEN123", log.read_text())

    def test_embedded_copy_matches_decide_and_runs_without_a_sibling(self):
        extracted = self.root / "extracted.py"
        subprocess.check_call([
            "bash", "-c",
            "sed -n '/^# __DECIDE_PY__$/,/^# __DECIDE_END__$/p' \"$1\" | sed '1d;$d;s/^# //;s/^#$//' > \"$2\"",
            "bash", str(SCRIPT), str(extracted),
        ])
        self.assertEqual(extracted.read_bytes(), DECIDE.read_bytes())
        alone = self.root / "alone"
        alone.mkdir()
        target = alone / "fleet-node.sh"
        target.write_bytes(SCRIPT.read_bytes())
        target.chmod(0o755)
        dest = self.root / "downloaded.iso"
        env = self.env.copy()
        env["PATH"] = f"{self.bin}:{os.environ.get('PATH', '')}"
        result = subprocess.run(
            [str(target), "fetch", str(dest)],
            capture_output=True,
            text=True,
            env=env,
            cwd=alone,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(dest.read_bytes(), ISO_BYTES)
        self.assertFalse(self.git_log.exists())
        self.assertFalse(self.nix_log.exists())

    def test_fetch_writes_the_durable_bytes_twice_and_fails_closed(self):
        dest = self.root / "out.iso"
        first = self.run_entry(["fetch", str(dest)])
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(dest.read_bytes(), ISO_BYTES)
        second = self.run_entry(["fetch", str(dest)])
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(dest.read_bytes(), ISO_BYTES)
        self.assertFalse(self.git_log.exists())
        self.assertFalse(self.nix_log.exists())
        log = self.curl_log.read_text()
        self.assertNotIn("actions/artifacts", log)
        self.assertNotIn("run download", log)
        self.assertGreaterEqual(log.count("fleet-installer.iso"), 2)

        self.curl_log.write_text("")
        self.curl_mode.write_text("fail")
        missing = self.root / "missing.iso"
        missing.write_bytes(b"OLD")
        failed = self.run_entry(["fetch", str(missing)])
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(missing.read_bytes(), b"OLD")
        self.assert_one_next(self.combined(failed))

        self.curl_mode.write_text("expire")
        expired = self.root / "expired.iso"
        expired.write_bytes(b"OLD")
        ended = self.run_entry(["fetch", str(expired)])
        self.assertNotEqual(ended.returncode, 0)
        self.assertEqual(expired.read_bytes(), b"OLD")
        self.assert_one_next(self.combined(ended))
        self.assertIn("expired", self.combined(ended).lower())

        self.curl_mode.write_text("bad-sum")
        mismatch = self.root / "mismatch.iso"
        bad = self.run_entry(["fetch", str(mismatch)])
        self.assertNotEqual(bad.returncode, 0)
        self.assertFalse(mismatch.exists())
        self.assert_one_next(self.combined(bad))

    def test_each_role_is_confirmed_and_records_a_marker_without_a_secret(self):
        for role in ("ci", "web", "cache", "netboot", "devbox"):
            with self.subTest(role=role):
                self.boot_log.unlink(missing_ok=True)
                marker = self.state / "installed"
                marker.unlink(missing_ok=True)
                env = dict(self.env)
                if role == "devbox":
                    env["FLEET_DEVBOX_SSH_KEY"] = "ssh-ed25519 " + base64.b64encode(b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" + b"x" * 32).decode()
                result = self.run_entry([role], confirm_line(role), env=env)
                text = self.combined(result)
                self.assertEqual(result.returncode, 0, text)
                self.assertLess(text.index(f"Role: {role}"), text.index("FLEET-WIPE"))
                self.assertLess(text.index(PLAIN), text.index("FLEET-WIPE"))
                self.assertIn(f"FLEET-WIPE role={role}", text)
                self.assert_no_secrets(text)
                self.assertNotIn("/dev/", text)
                body = marker.read_text()
                self.assertIn(f"role={role}\n", body)
                self.assertIn("status=installed\n", body)
                self.assertNotIn("hostname=", body)
                self.assertNotIn("/dev/", body)
                boot = self.boot_log.read_text()
                load_line = next(line for line in boot.splitlines() if "--load" in line)
                self.assertIn("--initrd=", load_line)
                self.assertIn("copytoram", load_line)
                self.assertIn("findiso=", load_line)
                self.assertTrue(load_line.endswith(f"fleet.role={role}"))
                self.assertLess(load_line.index("copytoram"), load_line.index(f"fleet.role={role}"))
                self.assertNotIn("fleet-installer.iso", load_line.split("findiso=", 1)[0])
                self.assertFalse(self.dd_log.exists())
                self.assertFalse(self.git_log.exists())
                self.assertFalse(self.nix_log.exists())

    def test_second_install_does_not_wipe_and_a_mismatch_leaves_the_marker(self):
        first = self.run_entry(["ci"], confirm_line("ci"))
        self.assertEqual(first.returncode, 0, first.stderr)
        marker = (self.state / "installed").read_bytes()
        boots = self.boot_log.read_text()
        second = self.run_entry(["ci"], confirm_line("ci"))
        second_text = self.combined(second)
        self.assertEqual(second.returncode, 0, second_text)
        self.assertIn("Role: ci", second_text)
        self.assertIn(PLAIN, second_text)
        self.assertNotIn("FLEET-WIPE", second_text)
        self.assertIn("not wiped", second_text)
        self.assertEqual((self.state / "installed").read_bytes(), marker)
        self.assertEqual(self.boot_log.read_text(), boots)
        self.assert_no_secrets(second_text)
        refused = self.run_entry(["ci"], "nope\n")
        refused_text = self.combined(refused)
        self.assertNotEqual(refused.returncode, 0)
        self.assert_one_next(refused_text)
        self.assertNotIn("FLEET-WIPE", refused_text)
        self.assertEqual((self.state / "installed").read_bytes(), marker)
        self.assertEqual(self.boot_log.read_text(), boots)

    def test_timeout_and_empty_confirmation_do_not_wipe(self):
        env = self.env.copy()
        env["FLEET_CONFIRM_TIMEOUT"] = "1"
        proc = subprocess.Popen(
            [str(SCRIPT), "ci"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=self.root,
        )
        # stdin stays open until the program exits on its own timeout, so a slow
        # start cannot turn the timeout into an end-of-input answer.
        proc.wait(timeout=60)
        out, err = proc.stdout.read(), proc.stderr.read()
        proc.stdin.close()
        text = out.decode() + err.decode()
        self.assertNotEqual(proc.returncode, 0)
        self.assert_one_next(text)
        self.assertIn("no answer arrived", text)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse((self.state / "installed").exists())

        empty = self.run_entry(["ci"], "\n")
        empty_text = self.combined(empty)
        self.assertNotEqual(empty.returncode, 0)
        self.assert_one_next(empty_text)
        self.assertIn("empty", empty_text)
        self.assertFalse(self.boot_log.exists())

    def test_bad_role_does_not_touch_a_disk(self):
        result = self.run_entry(["ci-gpu"])
        text = self.combined(result)
        self.assertEqual(result.returncode, 2, text)
        self.assert_one_next(text)
        self.assertIn("ci-gpu", text)
        self.assertFalse(self.curl_log.exists())
        self.assertFalse(self.boot_log.exists())

    def test_yes_installs_without_typing_and_never_waits_for_input(self):
        for args in (["ci", "--yes"], ["--yes", "web"], ["install", "cache", "-y"]):
            with self.subTest(args=args):
                self.boot_log.unlink(missing_ok=True)
                (self.state / "installed").unlink(missing_ok=True)
                result = self.run_entry(args, "", timeout=15)
                text = self.combined(result)
                self.assertEqual(result.returncode, 0, text)
                self.assertIn("FLEET-WIPE", text)
                self.assertTrue(self.boot_log.exists())

    def test_the_environment_can_say_yes(self):
        env = self.env.copy()
        env["FLEET_YES"] = "1"
        result = self.run_entry(["netboot"], "", env)
        self.assertEqual(result.returncode, 0, self.combined(result))
        self.assertIn("FLEET-WIPE role=netboot", self.combined(result))

    def test_a_mounted_internal_disk_is_the_running_system_and_installs(self):
        for os_name in ("Linux", "Darwin", "Windows"):
            with self.subTest(os_name=os_name):
                self._write_scenario("mounted")
                self.boot_log.unlink(missing_ok=True)
                (self.state / "installed").unlink(missing_ok=True)
                env = self.env.copy()
                env["FLEET_OS"] = os_name
                result = self.run_entry(["ci", "--yes"], "", env)
                self.assertEqual(result.returncode, 0, self.combined(result))
                self.assertIn("FLEET-WIPE role=ci", self.combined(result))

    def test_yes_does_not_override_a_disk_refusal(self):
        for scenario in ("usb-only", "ambiguous", "hotplug", "removable"):
            with self.subTest(scenario=scenario):
                self._write_scenario(scenario)
                self.boot_log.unlink(missing_ok=True)
                result = self.run_entry(["ci", "--yes"], "")
                self.assertNotEqual(result.returncode, 0, self.combined(result))
                self.assertNotIn("FLEET-WIPE", self.combined(result))
                self.assertFalse(self.boot_log.exists())

    def test_a_token_file_reaches_the_installer_command_line_but_never_the_output(self):
        token = self.root / "token"
        token.write_text("hvs.CAESIwrapped\n")
        result = self.run_entry(["ci", "--yes", "--token-file", str(token)], "")
        text = self.combined(result)
        self.assertEqual(result.returncode, 0, text)
        self.assertNotIn("hvs.CAESIwrapped", text)
        load_line = next(line for line in self.boot_log.read_text().splitlines() if "--load" in line)
        self.assertIn("fleet.enroll=hvs.CAESIwrapped", load_line)
        self.assertTrue(load_line.endswith("fleet.role=ci"))

    def test_the_token_can_come_from_the_environment(self):
        env = self.env.copy()
        env["FLEET_ENROLL_TOKEN"] = "hvs.CAESIwrapped"
        self._lookup("web")
        result = self.run_entry(["web", "--yes"], "", env)
        self.assertEqual(result.returncode, 0, self.combined(result))
        self.assertIn("fleet.enroll=hvs.CAESIwrapped", self.boot_log.read_text())

    def test_no_token_means_no_enroll_argument(self):
        result = self.run_entry(["ci", "--yes"], "")
        self.assertEqual(result.returncode, 0, self.combined(result))
        self.assertNotIn("fleet.enroll", self.boot_log.read_text())

    def test_a_token_on_the_command_line_is_refused(self):
        for args in (["ci", "--yes", "--token", "hvs.CAESIwrapped"], ["ci", "--yes", "--token=hvs.CAESIwrapped"]):
            with self.subTest(args=args):
                result = self.run_entry(args, "")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("hvs.CAESIwrapped", self.combined(result))
                self.assertFalse(self.boot_log.exists())

    def test_a_malformed_token_writes_nothing(self):
        env = self.env.copy()
        env["FLEET_ENROLL_TOKEN"] = "has space and ; junk"
        result = self.run_entry(["ci", "--yes"], "", env)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse((self.state / "installed").exists())

    def test_disk_refusals_match_on_windows_macos_and_linux(self):
        cases = (
            ("usb-only", ["ci"], "removable"),
            ("ambiguous", ["ci"], "more than one internal disk"),
            ("hotplug", ["ci"], "hotplug"),
            ("removable", ["ci"], "removable"),
            ("internal-only", ["flash"], "internal disk"),
        )
        for os_name in ("Linux", "Darwin", "Windows"):
            for scenario, args, needle in cases:
                with self.subTest(os_name=os_name, scenario=scenario):
                    self._write_scenario(scenario)
                    self.boot_log.unlink(missing_ok=True)
                    self.dd_log.unlink(missing_ok=True)
                    env = self.env.copy()
                    env["FLEET_OS"] = os_name
                    result = self.run_entry(args, "", env)
                    text = self.combined(result)
                    self.assertNotEqual(result.returncode, 0, text)
                    self.assert_one_next(text)
                    self.assertIn(needle, text)
                    if os_name == "Windows":
                        command = (self.root / "powershell-cmd").read_text()
                        self.assertIn("Get-CimAssociatedInstance", command)
                        self.assertIn("Win32_LogicalDisk", command)
                        self.assertNotIn("Mounted=$false", command)
                    self.assertNotIn("FLEET-WIPE", text)
                    self.assertFalse(self.boot_log.exists())
                    self.assertFalse(self.dd_log.exists())
                    self.assertFalse((self.state / "installed").exists())

    def test_real_macos_diskutil_phrases_name_the_internal_ssd(self):
        apple = textwrap.dedent("""\
            Device Node: /dev/disk0
            Device / Media Name: APPLE SSD AP0512Z
            Protocol: Apple Fabric
            Device Location: Internal
            Removable Media: Fixed
            Mounted: Not applicable (no file system)
            Whole: Yes
            Disk Size: 500.3 GB (500277792768 Bytes)
            """)
        synthesized = textwrap.dedent("""\
            Device Node: /dev/disk3
            Device / Media Name: APPLE SSD AP0512Z
            Protocol: Apple Fabric
            Device Location: Internal
            Removable Media: Fixed
            Mounted: No
            Whole: Yes
            Virtual: Yes
            Disk Size: 500.3 GB (500277792768 Bytes)
            """)
        external = textwrap.dedent("""\
            Device Node: /dev/disk6
            Device / Media Name: WD_BLACK SN850X 2000GB
            Protocol: PCI-Express
            Device Location: External
            Removable Media: Fixed
            Mounted: Not applicable (no file system)
            Whole: Yes
            Virtual: No
            Disk Size: 2.0 TB (2000398934016 Bytes)
            """)
        self._darwin([
            {"node": "/dev/disk0", "kind": "internal, physical", "info": apple},
            {"node": "/dev/disk3", "kind": "synthesized", "info": synthesized},
            {"node": "/dev/disk6", "kind": "external, physical", "info": external},
        ])
        env = self.env.copy()
        env["FLEET_OS"] = "Darwin"
        result = self.run_entry(["ci"], "\n", env)
        text = self.combined(result)
        self.assertNotEqual(result.returncode, 0, text)
        self.assertIn("internal NVMe, 500.2 GB, APPLE SSD AP0512Z", text)
        self.assertNotIn("the only disk is hotplug", text)
        self.assertNotIn("more than one internal disk", text)
        self.assertNotIn("FLEET-WIPE", text)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse(self.dd_log.exists())

        self._darwin([
            {"node": "/dev/disk6", "kind": "external, physical", "info": external},
        ])
        flashed = self.run_entry(["flash"], "", env)
        flash_text = self.combined(flashed)
        self.assertNotEqual(flashed.returncode, 0, flash_text)
        self.assert_one_next(flash_text)
        self.assertNotIn("internal disk", flash_text)
        self.assertIn("USB", flash_text)
        self.assertFalse(self.dd_log.exists())

    def test_windows_volumes_and_numeric_bus_decide_the_disk(self):
        env = self.env.copy()
        env["FLEET_OS"] = "Windows"
        self._windows([{
            "DeviceID": r"\\.\PHYSICALDRIVE0",
            "Model": "Samsung SSD 980",
            "Size": 2000000000000,
            "InterfaceType": "SCSI",
            "BusType": "17",
            "MediaType": "Fixed hard disk media",
            "PNPDeviceID": "SCSI\\DISK",
            "SerialNumber": "S5",
            "Volumes": ["C:"],
            "Mounted": False,
        }])
        # C: is on this disk because Windows is running from it. That is the
        # machine being converted, not a reason to refuse.
        mounted = self.run_entry(["ci"], confirm_line("ci"), env)
        mounted_text = self.combined(mounted)
        self.assertEqual(mounted.returncode, 0, mounted_text)
        self.assertIn("FLEET-WIPE role=ci", mounted_text)
        command = (self.root / "powershell-cmd").read_text()
        self.assertIn("Win32_LogicalDisk", command)
        self.assertNotIn("Mounted=$false", command)

        self.boot_log.unlink(missing_ok=True)
        (self.state / "installed").unlink(missing_ok=True)
        self._windows([{
            "DeviceID": r"\\.\PHYSICALDRIVE0",
            "Model": "Samsung SSD 980",
            "Size": 2000000000000,
            "InterfaceType": "SCSI",
            "BusType": 17,
            "MediaType": "Fixed hard disk media",
            "PNPDeviceID": "SCSI\\DISK",
            "SerialNumber": "S5",
            "Volumes": [],
            "Mounted": True,
        }])
        installed = self.run_entry(["ci"], confirm_line("ci"), env)
        installed_text = self.combined(installed)
        self.assertEqual(installed.returncode, 0, installed_text)
        self.assertIn(PLAIN, installed_text)
        self.assertIn("FLEET-WIPE role=ci", installed_text)
        self.assertNotIn("mounted", installed_text.lower())

    def test_windows_stdin_wait_confirms_and_times_out(self):
        self._write_scenario("happy")
        env = self.env.copy()
        env["FLEET_OS"] = "Windows"
        env["FLEET_STDIN_WAIT"] = "windows"
        env["FLEET_CONFIRM_TIMEOUT"] = "1"
        proc = subprocess.Popen(
            [str(SCRIPT), "ci"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=self.root,
        )
        # stdin stays open until the program exits on its own timeout, so a slow
        # start cannot turn the timeout into an end-of-input answer.
        proc.wait(timeout=60)
        out, err = proc.stdout.read(), proc.stderr.read()
        proc.stdin.close()
        text = out.decode() + err.decode()
        self.assertNotEqual(proc.returncode, 0, text)
        self.assert_one_next(text)
        self.assertIn("no answer arrived", text)
        self.assertNotIn("Traceback", text)
        self.assertNotIn("WinError", text)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse((self.state / "installed").exists())

        env["FLEET_CONFIRM_TIMEOUT"] = "5"
        confirmed = self.run_entry(["ci"], confirm_line("ci"), env)
        confirmed_text = self.combined(confirmed)
        self.assertEqual(confirmed.returncode, 0, confirmed_text)
        self.assertIn("FLEET-WIPE role=ci", confirmed_text)
        self.assertNotIn("Traceback", confirmed_text)

    def test_shipped_entry_classifies_windows_without_uname_or_fleet_os(self):
        hook = self.root / "pyhook"
        hook.mkdir()
        (hook / "sitecustomize.py").write_text(
            "import os, sys\n"
            "import hashlib, json, re, select, shutil, subprocess, tempfile, threading\n"
            "import pathlib\n"
            "sys.platform = 'win32'\n"
            "if hasattr(os, 'uname'):\n"
            "    del os.uname\n"
        )
        self._write_scenario("happy")
        (self.root / "powershell-cmd").unlink(missing_ok=True)
        alone = self.root / "downloaded"
        alone.mkdir()
        target = alone / "fleet-node.sh"
        target.write_bytes(SCRIPT.read_bytes())
        target.chmod(0o755)
        env = self.env.copy()
        env.pop("FLEET_OS", None)
        self.assertNotIn("FLEET_OS", env)
        env["PYTHONPATH"] = str(hook) + os.pathsep + env.get("PYTHONPATH", "")
        result = subprocess.run(
            [str(target), "ci"],
            input=confirm_line("ci"),
            capture_output=True,
            text=True,
            env=env,
            cwd=alone,
            timeout=15,
            check=False,
        )
        text = result.stdout + result.stderr
        self.assertNotIn("Traceback", text)
        self.assertNotIn("AttributeError", text)
        self.assertEqual(result.returncode, 0, text)
        self.assertIn("Role: ci", text)
        self.assertIn(PLAIN, text)
        self.assertIn("FLEET-WIPE role=ci", text)
        command = (self.root / "powershell-cmd").read_text()
        self.assertIn("Get-CimAssociatedInstance", command)
        self.assertIn("Win32_LogicalDisk", command)

    def test_flash_writes_only_the_usb_disk_on_each_os(self):
        expect = {
            "Linux": "of=/dev/sdb",
            "Darwin": "of=/dev/rdisk4",
            "Windows": "of=\\\\.\\PHYSICALDRIVE1",
        }
        for os_name, needle in expect.items():
            with self.subTest(os_name=os_name):
                self._write_scenario("happy")
                self.dd_log.unlink(missing_ok=True)
                env = self.env.copy()
                env["FLEET_OS"] = os_name
                result = self.run_entry(["flash"], f"flash: {USB_PLAIN}\n", env)
                text = self.combined(result)
                self.assertEqual(result.returncode, 0, text)
                self.assertIn(USB_PLAIN, text)
                self.assertLess(text.index(USB_PLAIN), text.index("FLEET-WIPE"))
                log = self.dd_log.read_text()
                self.assertIn(needle, log)
                self.assertNotIn("nvme", log)
                self.assertNotIn("disk0", log)
                self.assertNotIn("PHYSICALDRIVE0", log)
                self.assert_no_secrets(text)

    def test_each_os_stages_a_confirmed_ci_install_with_its_own_boot_tool(self):
        for os_name, key in (
            ("Linux", "FLEET_KEXEC"),
            ("Darwin", "FLEET_DARWIN_BOOT"),
            ("Windows", "FLEET_WINDOWS_BOOT"),
        ):
            with self.subTest(os_name=os_name):
                self._write_scenario("happy")
                marker = self.state / "installed"
                marker.unlink(missing_ok=True)
                own = self.root / f"boot-{os_name}"
                other = self.root / f"other-{os_name}"
                write_executable(self.bin / f"boot-{os_name}", f"""\
                    #!/bin/bash
                    printf '%s\\n' "$*" >> {own}
                    """)
                write_executable(self.bin / f"other-{os_name}", f"""\
                    #!/bin/bash
                    printf '%s\\n' "$*" >> {other}
                    exit 99
                    """)
                env = self.env.copy()
                env["FLEET_OS"] = os_name
                env["FLEET_KEXEC"] = str(self.bin / "other-Linux") if os_name != "Linux" else str(self.bin / f"boot-{os_name}")
                env["FLEET_DARWIN_BOOT"] = str(self.bin / f"boot-{os_name}") if os_name == "Darwin" else str(self.bin / f"other-{os_name}")
                env["FLEET_WINDOWS_BOOT"] = str(self.bin / f"boot-{os_name}") if os_name == "Windows" else str(self.bin / f"other-{os_name}")
                if os_name == "Linux":
                    env["FLEET_KEXEC"] = str(self.bin / "boot-Linux")
                    env["FLEET_DARWIN_BOOT"] = str(self.bin / "other-Linux")
                    env["FLEET_WINDOWS_BOOT"] = str(self.bin / "other-Linux")
                result = self.run_entry(["ci"], confirm_line("ci"), env)
                text = self.combined(result)
                self.assertEqual(result.returncode, 0, text)
                self.assertIn("role=ci\n", marker.read_text())
                self.assertIn("fleet.role=ci", own.read_text())
                self.assertFalse(other.exists())
                self.assert_no_secrets(text)


    def test_an_unreadable_image_or_unsupported_filesystem_does_not_wipe(self):
        bad = self.env.copy()
        bad["FLEET_ISO_FS"] = "apfs"
        refused = self.run_entry(["ci"], confirm_line("ci"), bad)
        text = self.combined(refused)
        self.assertNotEqual(refused.returncode, 0, text)
        self.assert_one_next(text)
        self.assertIn("flash", text)
        self.assertNotIn("FLEET-WIPE", text)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse((self.state / "installed").exists())

        self.iso.write_bytes(b"not-an-iso\n")
        digest = hashlib.sha256(b"not-an-iso\n").hexdigest()
        write_executable(self.bin / "curl", f"""\
            #!/bin/bash
            out=""
            prev=""
            for arg in "$@"; do
              if [ "$prev" = "-o" ]; then out=$arg; fi
              prev=$arg
            done
            url=${{@: -1}}
            case "$url" in
              *.sha256) printf '{digest}  fleet-installer.iso\\n' > "$out" ;;
              *) cp {self.iso} "$out" ;;
            esac
            """)
        broken = self.run_entry(["ci"], confirm_line("ci"))
        broken_text = self.combined(broken)
        self.assertNotEqual(broken.returncode, 0, broken_text)
        self.assertIn("not an ISO9660 image", broken_text)
        self.assertEqual(broken.returncode, 71)
        self.assertNotIn("FLEET-WIPE", broken_text)
        self.assertFalse(self.boot_log.exists())
        self.assertFalse((self.state / "installed").exists())


class OsClassifyTests(unittest.TestCase):
    def test_nt_without_uname_or_fleet_os_is_windows(self):
        spec = importlib.util.spec_from_file_location("fleet_decide_under_test", DECIDE)
        decide = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(decide)
        saved_name = decide.os.name
        saved_platform = decide.sys.platform
        saved_uname = getattr(decide.os, "uname", None)
        saved_override = os.environ.pop("FLEET_OS", None)
        try:
            decide.os.name = "nt"
            decide.sys.platform = "win32"
            if hasattr(decide.os, "uname"):
                del decide.os.uname
            self.assertFalse(hasattr(decide.os, "uname"))
            self.assertNotIn("FLEET_OS", os.environ)
            self.assertEqual(decide.current_os(), "Windows")
            decide.os.name = "posix"
            decide.sys.platform = "win32"
            self.assertEqual(decide.current_os(), "Windows")
            decide.sys.platform = "linux"
            self.assertEqual(decide.current_os(), "unknown")
        finally:
            decide.os.name = saved_name
            decide.sys.platform = saved_platform
            if saved_uname is not None:
                decide.os.uname = saved_uname
            if saved_override is not None:
                os.environ["FLEET_OS"] = saved_override


class RemoveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.state = self.root / "state"
        self.state.mkdir()
        self.busy = self.root / "busy"
        (self.busy / "slot-1").mkdir(parents=True)
        self.control_log = self.root / "control"
        self.stop_log = self.root / "stop"
        write_executable(self.bin / "runner-control", f"""\
            #!/bin/bash
            printf '%s\\n' "$*" >> {self.control_log}
            if [ -f {self.root}/control-fail ]; then exit 99; fi
            exit 0
            """)
        write_executable(self.bin / "systemctl", f"""\
            #!/bin/bash
            printf '%s\\n' "$*" >> {self.stop_log}
            exit 99
            """)
        write_executable(self.bin / "hostname", """\
            #!/bin/bash
            echo must-not-be-called
            exit 99
            """)
        (self.root / "node.conf").write_text("role=ci\n")
        (self.root / "runner.conf").write_text(
            "scope=organization\napp_id=123\ninstallation_id=456\ntarget=example-org\n"
        )
        self.key = self.root / "github-app-key"
        self.key.write_text("already-on-the-machine\n")
        self.env = os.environ.copy()
        self.env.update({
            "PATH": f"{self.bin}:{os.environ.get('PATH', '')}",
            "FLEET_STATE": str(self.state),
            "FLEET_BUSY_DIR": str(self.busy),
            "FLEET_CREDENTIAL": str(self.key),
            "FLEET_NODE_CONF": str(self.root / "node.conf"),
            "FLEET_RUNNER_CONF": str(self.root / "runner.conf"),
            "FLEET_RUNNER_CONTROL": str(self.bin / "runner-control"),
            "FLEET_HOSTNAME": "ci-test",
        })

    def tearDown(self):
        self.tmp.cleanup()

    def run_remove(self, env=None):
        return subprocess.run(
            [str(SCRIPT), "remove"],
            capture_output=True,
            text=True,
            env=env or self.env,
            cwd=self.root,
            check=False,
        )

    def test_idle_removal_is_safe_to_repeat_without_the_first_call_still_pending(self):
        first = self.run_remove()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("The machine can be powered off.", first.stderr)
        self.assertNotIn("unregistered", (first.stdout + first.stderr).lower())
        self.assertIn("withdraw ", self.control_log.read_text())
        self.assertNotIn("stop", self.control_log.read_text())
        self.assertFalse(self.stop_log.exists())
        calls = self.control_log.read_text()
        self.key.unlink()
        (self.root / "control-fail").write_text("1")
        second = self.run_remove()
        text = second.stdout + second.stderr
        self.assertEqual(second.returncode, 0, text)
        self.assertIn("The machine can be powered off.", text)
        self.assertEqual(self.control_log.read_text(), calls)
        self.assertFalse(self.stop_log.exists())

    def test_an_idle_removal_powers_the_node_off_by_itself(self):
        log = self.root / "poweroff"
        self.env["FLEET_POWEROFF"] = f"touch {log}"
        result = self.run_remove()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(log.exists())
        self.assertTrue((self.state / "withdrawn").is_file())

    def test_a_busy_node_is_not_powered_off(self):
        (self.busy / "slot-1" / "busy").write_text("running\n")
        log = self.root / "poweroff"
        self.env["FLEET_POWEROFF"] = f"touch {log}"
        result = self.run_remove()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(log.exists())

    def test_a_failed_power_off_still_leaves_the_node_withdrawn(self):
        self.env["FLEET_POWEROFF"] = "false"
        result = self.run_remove()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Power it off by hand", result.stderr)
        self.assertTrue((self.state / "withdrawn").is_file())

    def test_a_busy_job_is_not_stopped(self):
        (self.busy / "slot-1" / "busy").write_text("running\n")
        result = self.run_remove()
        text = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, text)
        self.assertIn("not stopped", text)
        self.assertNotIn("powered off", text)
        self.assertNotIn("unregistered", text.lower())
        self.assertTrue((self.busy / "slot-1" / "busy").is_file())
        log = self.control_log.read_text()
        self.assertIn("hold ", log)
        self.assertNotIn("withdraw ", log)
        self.assertNotIn("stop", log)
        self.assertFalse(self.stop_log.exists())
        self.assertFalse((self.state / "withdrawn").exists())

    def test_missing_credential_does_not_claim_the_node_was_unregistered(self):
        self.key.unlink()
        result = self.run_remove()
        text = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("unregistered", text.lower())
        self.assertNotIn("powered off", text)
        lines = [line for line in text.splitlines() if line.startswith("Next:")]
        self.assertEqual(len(lines), 1, text)
        self.assertFalse(self.control_log.exists())
        self.assertFalse(self.stop_log.exists())
        self.assertFalse((self.state / "withdrawn").exists())

    def test_a_web_node_without_a_runner_can_be_powered_off(self):
        (self.root / "node.conf").write_text("role=web\n")
        self.key.unlink()
        result = self.run_remove()
        text = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, text)
        self.assertIn("The machine can be powered off.", text)
        self.assertNotIn("unregistered", text.lower())
        self.assertFalse(self.control_log.exists())


if __name__ == "__main__":
    unittest.main()
