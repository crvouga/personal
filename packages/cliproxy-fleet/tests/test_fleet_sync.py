import importlib.util
import json
import pathlib
import tempfile
import unittest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'
DEFINITION = pathlib.Path(__file__).resolve().parents[2] / 'fleet/definition.json'
spec = importlib.util.spec_from_file_location('fleet_sync', SCRIPTS / 'fleet_sync.py')
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)
host = fleet.cliproxy_host
SHA = 'a' * 40
MANAGER = 'chriss-macbook-air'
WORKER = 'chris-vouga-ms-a2'


class FleetSingleton(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.home = self.root / 'home'
        self.calls = []
        self.launchd = host.Launchd(uid=501, home=self.home)

    def command(self, args, timeout=120):
        self.calls.append(args)
        return False

    def active(self, args, timeout=120):
        self.calls.append(args)
        return True

    def owner(self, **kwargs):
        kwargs.setdefault('backend', self.launchd)
        kwargs.setdefault('identity', MANAGER)
        return fleet.reconcile(self.root, MANAGER, MANAGER, SHA, True, **kwargs)

    def runtime(self, endpoint=True):
        (self.root / 'state/runtime').mkdir(parents=True)
        (self.root / 'state/runtime/config.yaml').write_text('fixture')
        if endpoint:
            (self.root / 'state/public-endpoint-enabled').touch()

    def link_agents(self):
        self.launchd.unit_directory.mkdir(parents=True)
        for label in [host.LAUNCHD_SERVICE, *host.LAUNCHD_SCHEDULED]:
            self.launchd.plist(label).symlink_to(self.root / 'tracked.plist')

    def test_definition_v3_manager_owns_proxy(self):
        owner, workers = fleet.roles(json.loads(DEFINITION.read_text()))
        self.assertEqual(owner, MANAGER)
        self.assertIn(WORKER, workers)
        self.assertNotIn(owner, workers)
        with self.assertRaises(ValueError):
            fleet.roles({**json.loads(DEFINITION.read_text()), 'version': 2})

    def test_missing_state_never_seeds_or_restores_identity(self):
        result = self.owner(run=self.command)
        self.assertEqual(result['phases'][0]['code'], 'PROXY_RECOVERY_REQUIRED')
        self.assertEqual((result['role'], result['backend']), ('manager', 'launchd'))
        self.assertFalse(result['ok'])
        self.assertEqual(self.calls, [])

    def test_wrong_host_or_platform_never_acts_as_manager(self):
        self.runtime()
        result = self.owner(run=self.active, identity='chris-vouga-ms-a2')
        self.assertEqual(result['phases'][0]['code'], 'PROXY_IDENTITY_MISMATCH')
        result = self.owner(run=self.active, backend=host.Systemd())
        self.assertEqual(result['phases'][0]['code'], 'PROXY_PLATFORM_MISMATCH')
        self.assertEqual(self.calls, [])

    def test_clean_worker_is_client(self):
        result = fleet.reconcile(self.root, WORKER, MANAGER, SHA, True, run=self.command,
                                 backend=host.Systemd())
        self.assertTrue(result['ok'])
        self.assertEqual(result['role'], 'worker')
        self.assertEqual(result['phases'][0]['code'], 'PROXY_CLIENT_ROLE')
        self.assertTrue(all(call[0] == 'systemctl' and call[1] in ['is-active', 'is-enabled']
                            for call in self.calls))

    def test_worker_hosting_proxy_is_reported_never_stopped(self):
        (self.root / 'INSTALLATION.json').write_text('{}')
        result = fleet.reconcile(self.root, WORKER, MANAGER, SHA, True, maintenance=True,
                                 run=self.active, backend=host.Systemd())
        phase = result['phases'][0]
        self.assertEqual(phase['code'], 'PROXY_DUPLICATE_OWNER')
        self.assertIn('migration.md', phase['remedy']['action'])
        self.assertFalse(result['ok'])
        self.assertTrue(all(call[1] in ['is-active', 'is-enabled'] for call in self.calls))

    def test_fenced_worker_install_awaits_decommission(self):
        (self.root / 'INSTALLATION.json').write_text('{}')
        result = fleet.reconcile(self.root, WORKER, MANAGER, SHA, True, run=self.command,
                                 backend=host.Systemd())
        self.assertEqual(result['phases'][0]['code'], 'PROXY_DECOMMISSION_PENDING')
        self.assertFalse(result['ok'])

    def test_revision_upgrade_requires_maintenance(self):
        self.runtime()
        result = self.owner(run=self.command, audit_fn=lambda root: (True, 'b' * 40),
                            compatible_fn=lambda installed, desired: False)
        self.assertEqual(result['phases'][0]['code'], 'PROXY_UPDATE_PENDING')
        self.assertEqual(self.calls, [])

    def test_maintenance_installs_without_sudo_on_manager(self):
        self.runtime()
        self.owner(run=self.command, maintenance=True, audit_fn=lambda root: (True, 'b' * 40),
                   compatible_fn=lambda installed, desired: False)
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn('sudo', self.calls[0])
        self.assertTrue(self.calls[0][2].endswith('install.py'))
        self.assertEqual(self.calls[0][-2:], ['--revision', SHA])

    def test_stopped_agents_are_bootstrapped_in_gui_domain(self):
        self.runtime()
        self.link_agents()
        result = self.owner(run=self.command, audit_fn=lambda root: (True, SHA),
                            endpoint_check=lambda root: True)
        loads = [call for call in self.calls if call[1] == 'bootstrap']
        self.assertEqual(
            [call[3] for call in loads],
            [str(self.launchd.plist(label)) for label in [*host.LAUNCHD_SCHEDULED[:2], host.LAUNCHD_SERVICE]])
        self.assertTrue(all(call[2] == 'gui/501' for call in loads))
        self.assertFalse(any('sudo' in call for call in self.calls))
        self.assertFalse(result['ok'])

    def test_correct_manager_does_not_restart_or_probe_management(self):
        self.runtime()
        self.link_agents()
        result = self.owner(run=self.active, audit_fn=lambda root: (True, SHA),
                            endpoint_check=lambda root: True)
        self.assertTrue(result['ok'])
        self.assertFalse(result['changed'])
        self.assertEqual(result['phases'][-1]['code'], 'PROXY_ENDPOINT_AUTH')
        self.assertIn('PROXY_UNIT_DEV_CHRISVOUGA_CLIPROXY_FLEET', {p['code'] for p in result['phases']})
        self.assertTrue(all(call[:2] == ['launchctl', 'print'] for call in self.calls))

    def test_unrelated_monorepo_update_does_not_restart_identical_gateway_source(self):
        self.runtime()
        self.link_agents()
        result = self.owner(run=self.active, audit_fn=lambda root: (True, 'b' * 40),
                            endpoint_check=lambda root: True,
                            compatible_fn=lambda installed, desired: True)
        self.assertTrue(result['ok'])
        self.assertFalse(result['changed'])
        self.assertTrue(all(call[:2] == ['launchctl', 'print'] for call in self.calls))
