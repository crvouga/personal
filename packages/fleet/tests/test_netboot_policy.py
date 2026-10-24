#!/usr/bin/env python3
"""The netboot policy selects the installer answer only for a flagged id or role. That answer does not install a node."""

import importlib.util
import json
import os
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "netboot_policy",
    Path(__file__).parents[1] / "scripts" / "netboot-policy.py",
)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

UUID = "12345678-1234-1234-1234-123456789abc"


class DecideTests(unittest.TestCase):
    def ident(self):
        return policy.cattle.stable_id(UUID, None)

    def test_empty_policy_boots_the_local_disk(self):
        self.assertEqual(policy.decide(UUID, None, "", [], []), "local")
        self.assertEqual(policy.decide(UUID, None, "ci", [], []), "local")

    def test_flagged_node_gets_the_installer(self):
        self.assertEqual(policy.decide(UUID, None, "", [self.ident()], []), "installer")
        self.assertEqual(policy.decide(UUID, None, "web", [self.ident()], []), "installer")

    def test_other_node_stays_on_disk(self):
        self.assertEqual(policy.decide(UUID, None, "", ["ffff"], []), "local")

    def test_flagged_role_gets_the_installer(self):
        self.assertEqual(policy.decide(UUID, None, "ci", [], ["ci"]), "installer")
        self.assertEqual(policy.decide(UUID, None, "web", [], ["ci"]), "local")
        self.assertEqual(policy.decide("", None, "", [], ["ci"]), "local")

    def test_ci_gpu_is_role_ci(self):
        self.assertEqual(policy.decide(UUID, None, "ci-gpu", [], ["ci-gpu"]), "local")
        self.assertEqual(policy.decide(UUID, None, "ci", [], ["ci"]), "installer")

    def test_broken_policy_is_local(self):
        self.assertEqual(policy.load_policy("/no/such/file"), ([], []))


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self._tmpdir())
        self.policy_path = self.tmp / "reinstall.json"
        self.policy_path.write_text(json.dumps({"nodes": [], "roles": []}))
        self.kernel_pointer = self.tmp / "kernel-path"
        self.kernel = self.tmp / "kernel"
        self.kernel.write_bytes(b"kernel-bytes")
        self.kernel_pointer.write_text(str(self.kernel) + "\n")
        self.cmdline = self.tmp / "cmdline"
        self.cmdline.write_text("init=/nix/store/installer/init\n")
        os.environ["FLEET_POLICY"] = str(self.policy_path)
        os.environ["FLEET_KERNEL_FILE"] = str(self.kernel_pointer)
        os.environ["FLEET_CMDLINE_FILE"] = str(self.cmdline)
        os.environ["FLEET_NETBOOT_BIND"] = "127.0.0.1"
        os.environ["FLEET_NETBOOT_PORT"] = "0"
        self.server = policy.ThreadingHTTPServer(("127.0.0.1", 0), policy.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def _tmpdir(self):
        import tempfile
        self._dir = tempfile.TemporaryDirectory()
        return self._dir.name

    def tearDown(self):
        self.server.server_close()
        self.thread.join(timeout=2)
        self._dir.cleanup()

    def get(self, path):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("GET", path)
        response = connection.getresponse()
        body = response.read()
        status = response.status
        connection.close()
        return status, body

    def test_default_choice_is_local_disk(self):
        status, body = self.get("/fleet/choose?uuid=%s&mac=&role=" % UUID)
        self.assertEqual(status, 200)
        self.assertIn(b"exit 1", body)
        self.assertNotIn(b"kernel ", body)

    def test_flagged_node_is_served_the_installer(self):
        ident = policy.cattle.stable_id(UUID, None)
        self.policy_path.write_text(json.dumps({"nodes": [ident], "roles": []}))
        status, body = self.get("/fleet/choose?uuid=%s&mac=&role=" % UUID)
        self.assertEqual(status, 200)
        self.assertIn(b"kernel http://${next-server}:", body)
        self.assertIn(b"init=/nix/store/installer/init", body)
        file_status, file_body = self.get("/fleet/kernel")
        self.assertEqual(file_status, 200)
        self.assertEqual(file_body, b"kernel-bytes")

    def test_boot_endpoint_returns_a_probe_script(self):
        status, body = self.get("/v1/boot/aa:bb:cc:dd:ee:ff")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertIn("file://SHBOOT/fleet-role.ipxe", payload["ipxe-script"])
        self.assertIn("/fleet/choose?", payload["ipxe-script"])
        bad, _ = self.get("/v1/boot/not-a-mac")
        self.assertEqual(bad, 400)


if __name__ == "__main__":
    unittest.main()
