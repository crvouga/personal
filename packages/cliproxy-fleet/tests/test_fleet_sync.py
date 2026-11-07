import importlib.util
import pathlib
import tempfile
import unittest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'
spec = importlib.util.spec_from_file_location('fleet_sync', SCRIPTS / 'fleet_sync.py')
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)
SHA = 'a' * 40


class FleetSingleton(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.calls = []

    def command(self, args, timeout=120):
        self.calls.append(args)
        return False

    def test_missing_state_never_seeds_or_restores_identity(self):
        result = fleet.reconcile(self.root, 'owner', 'owner', SHA, True, run=self.command)
        self.assertEqual(result['phases'][0]['code'], 'PROXY_RECOVERY_REQUIRED')
        self.assertFalse(result['ok'])
        self.assertEqual(self.calls, [])

    def test_nonowner_never_starts_proxy(self):
        result = fleet.reconcile(self.root, 'client', 'owner', SHA, True, run=self.command)
        self.assertTrue(result['ok'])
        self.assertTrue(all('enable' not in call for call in self.calls))

    def test_revision_upgrade_requires_maintenance(self):
        (self.root / 'state/runtime').mkdir(parents=True)
        (self.root / 'state/runtime/config.yaml').write_text('fixture')
        result = fleet.reconcile(self.root, 'owner', 'owner', SHA, True, run=self.command,
                                 audit_fn=lambda root: (True, 'b' * 40))
        self.assertEqual(result['phases'][0]['code'], 'PROXY_UPDATE_PENDING')
        self.assertEqual(self.calls, [])

    def test_correct_owner_does_not_restart_or_probe_management(self):
        (self.root / 'state/runtime').mkdir(parents=True)
        (self.root / 'state/runtime/config.yaml').write_text('fixture')
        (self.root / 'state/public-endpoint-enabled').touch()
        def active(args, timeout=120):
            self.calls.append(args)
            return True
        result = fleet.reconcile(self.root, 'owner', 'owner', SHA, True, run=active,
                                 audit_fn=lambda root: (True, SHA), endpoint_check=lambda root: True)
        self.assertTrue(result['ok'])
        self.assertFalse(result['changed'])
        self.assertTrue(all(call[1] in ['is-active', 'is-enabled'] for call in self.calls))

    def test_unrelated_monorepo_update_does_not_restart_identical_gateway_source(self):
        (self.root / 'state/runtime').mkdir(parents=True)
        (self.root / 'state/runtime/config.yaml').write_text('fixture')
        (self.root / 'state/public-endpoint-enabled').touch()
        def active(args, timeout=120):
            self.calls.append(args)
            return True
        result = fleet.reconcile(self.root, 'owner', 'owner', SHA, True, run=active,
                                 audit_fn=lambda root: (True, 'b' * 40),
                                 endpoint_check=lambda root: True,
                                 compatible_fn=lambda installed, desired: True)
        self.assertTrue(result['ok'])
        self.assertFalse(result['changed'])
        self.assertTrue(all(call[1] in ['is-active', 'is-enabled'] for call in self.calls))
