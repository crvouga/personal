"""Resume opens admission before starts and restores it on partial failure."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

MODULE = Path(__file__).parents[1] / 'modules/runners.nix'


class ResumeTests(unittest.TestCase):
    def run_resume(self, failure='', busy=False, update=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / 'runtime'
            runtime.mkdir()
            (runtime / 'draining').touch()
            (runtime / 'slot-count').write_text('2')
            if busy:
                (runtime / 'slot-2').mkdir()
                (runtime / 'slot-2/busy').touch()
            if update:
                (runtime / 'update-draining').touch()
            binary = root / 'bin'
            binary.mkdir()
            programs = {
                'flock': '#!/bin/sh\nexit 0\n',
                'fleetconf': '#!/bin/sh\ncase "$2" in runners.enabled) echo true;; *) echo false;; esac\n',
                'systemctl': f'''#!{sys.executable}
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
root = Path(os.environ['RESUME_FIXTURE'])
if args[0] == 'show':
 print('active' if os.environ.get('UPDATE_ACTIVE') else 'inactive')
elif args[0] == 'is-failed':
 sys.exit(1)
elif args[0] == 'stop' or '--no-block' in args:
 with (root / 'events').open('a') as log: log.write(json.dumps(args) + '\\n')
 if '--no-block' in args:
  assert not (root / 'runtime/draining').exists(), 'start condition still blocked'
  if args[-1] == os.environ.get('FAIL_START'): sys.exit(1)
''',
            }
            for name, program in programs.items():
                path = binary / name
                path.write_text(program)
                path.chmod(0o700)
            text = MODULE.read_text().split('  resume = ', 1)[1].split('  hooks = ', 1)[0]
            text = text.split("    text = ''\n", 1)[1].rsplit("    '';", 1)[0]
            text = text.replace("''${", '${').replace('${tools.fleetconf}/bin/fleetconf', shlex.quote(str(binary / 'fleetconf')))
            text = text.replace('/run/fleet', str(runtime)).replace('/run/systemd/system', str(root / 'systemd'))
            result = subprocess.run(['bash', '-euo', 'pipefail', '-c', text], capture_output=True, text=True,
                env={**os.environ, 'PATH': str(binary) + os.pathsep + os.environ.get('PATH', ''),
                     'RESUME_FIXTURE': directory, 'FAIL_START': failure, 'UPDATE_ACTIVE': '1' if update else ''})
            events = [json.loads(line) for line in (root / 'events').read_text().splitlines()] if (root / 'events').exists() else []
            return result, events, (runtime / 'draining').exists()

    def test_starts_pass_the_gate_and_busy_listeners_are_not_interrupted(self):
        result, events, blocked = self.run_resume(busy=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events, [['stop', 'github-runner-slot-1.service'], ['--no-block', 'start', 'github-runner-slot-1.service']])
        self.assertFalse(blocked)

    def test_partial_restart_failure_restores_admission_blocking(self):
        result, events, blocked = self.run_resume(failure='github-runner-slot-2.service')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events[-1], ['--no-block', 'start', 'github-runner-slot-2.service'])
        self.assertTrue(blocked)

    def test_active_update_keeps_every_listener_untouched_and_admission_blocked(self):
        result, events, blocked = self.run_resume(update=True)
        self.assertEqual(result.returncode, 75)
        self.assertEqual(events, [])
        self.assertTrue(blocked)
