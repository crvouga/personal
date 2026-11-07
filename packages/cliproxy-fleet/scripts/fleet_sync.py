#!/usr/bin/env python3
"""Fleet singleton reconciliation using the existing installer, systemd and endpoint owner."""
import sys
sys.dont_write_bytecode = True

import argparse
import importlib.util
import json
import os
import pathlib
import re
import socket
import subprocess
import time

SCRIPTS = pathlib.Path(__file__).resolve().parent
ROOT = pathlib.Path('/opt/cliproxy-fleet')
TIMERS = ['cliproxy-monitor.timer', 'cliproxy-vault-renew.timer',
          'cliproxy-backup.timer', 'cliproxy-backup-check.timer', 'cliproxy-gc.timer']


def execute(args, timeout=120):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def audit(root):
    spec = importlib.util.spec_from_file_location('fleet_audit', SCRIPTS / 'audit.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        manifest, errors = module.audit(root)
        return not errors, manifest.get('revision')
    except Exception:
        return False, None


def phase(code, status, summary, expected, observed, retryable=False):
    return {'id': 'proxy:' + code.lower().replace('_', '-'), 'code': code,
            'status': status, 'summary': summary, 'expected': expected,
            'observed': observed, 'retryable': retryable,
            'actionRequired': status in ('failed', 'action-required'),
            'scope': 'node', 'remedy': {'owner': 'cliproxy-fleet', 'action': summary}}


def equivalent_source(installed, revision):
    """A monorepo-only update must not force a running gateway to restart."""
    if not isinstance(installed, str) or not re.fullmatch('[a-f0-9]{40}', installed):
        return False
    try:
        result = subprocess.run(['git', '-C', str(SCRIPTS.parents[2]), 'rev-parse',
                                 installed + ':packages/cliproxy-fleet', revision + ':packages/cliproxy-fleet'],
                                capture_output=True, text=True, timeout=15)
        trees = result.stdout.splitlines()
        return result.returncode == 0 and len(trees) == 2 and all(re.fullmatch('[a-f0-9]{40}', tree) for tree in trees) and trees[0] == trees[1]
    except (OSError, subprocess.TimeoutExpired):
        return False


def inspect(root, node, owner, revision, run=execute, audit_fn=audit, compatible_fn=equivalent_source):
    if node != owner:
        active = (root / 'INSTALLATION.json').exists() or run(['systemctl', 'is-active', '--quiet', 'cliproxy-fleet.service'])
        return [phase('PROXY_DUPLICATE_OWNER' if active else 'PROXY_CLIENT_ROLE',
                      'action-required' if active else 'unchanged',
                      'This node must use the central gateway; review and fence an unexpected local host before proceeding.' if active else 'Client node; proxy hosting is owned elsewhere.',
                      'No proxy host on client nodes', 'Active local host' if active else 'No active host')]
    if not (root / 'state/runtime/config.yaml').is_file():
        return [phase('PROXY_RECOVERY_REQUIRED', 'action-required',
                      'Use the existing encrypted recovery flow after fencing the previous owner; never initialize a second provider identity.',
                      'Recovered runtime state on the designated owner', 'Runtime cache missing')]
    clean, installed = audit_fn(root)
    if not clean:
        return [phase('PROXY_SOURCE_DRIFT', 'action-required',
                      'Inspect cliproxy audit, preserve runtime state, then reinstall a reviewed revision during maintenance.',
                      'Clean tracked installation and units', 'Missing or modified deployment')]
    if installed != revision and not compatible_fn(installed, revision):
        return [phase('PROXY_UPDATE_PENDING', 'action-required',
                      'A proxy revision update can interrupt inference. Reapply with --maintenance in an approved window.',
                      revision, installed if isinstance(installed, str) and re.fullmatch('[0-9a-f]{40}', installed) else 'Unknown revision')]
    checks = []
    for unit in ['cliproxy-fleet.service', *TIMERS]:
        active = run(['systemctl', 'is-active', '--quiet', unit])
        enabled = run(['systemctl', 'is-enabled', '--quiet', unit])
        checks.append(phase('PROXY_UNIT_' + unit.replace('.', '_').replace('-', '_').upper(),
                            'unchanged' if active and enabled else 'action-required',
                            'Enable/start the declared unit; do not restart an already running gateway.',
                            'Enabled and active ' + unit,
                            'Enabled and active' if active and enabled else 'Stopped or disabled', True))
    if not (root / 'state/public-endpoint-enabled').exists():
        checks.append(phase('PROXY_ENDPOINT_DISABLED', 'action-required',
                            'Enable the existing public connector using its existing Vault credential.',
                            'Public connector enabled', 'Endpoint marker absent', True))
    return checks


def endpoint_health(root):
    try:
        spec = importlib.util.spec_from_file_location('fleet_external_health', SCRIPTS / 'external-health.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        endpoint = json.loads((SCRIPTS.parent / 'public-endpoint.json').read_text())['endpoint']
        key = (root / 'state/secrets/client-key').read_text().strip()
        module.endpoint_health(endpoint, key)
        return True
    except Exception:
        return False


def reconcile(root, node, owner, revision, apply=False, maintenance=False, run=execute, audit_fn=audit, endpoint_check=endpoint_health, compatible_fn=equivalent_source):
    started = time.monotonic()
    checks = inspect(root, node, owner, revision, run, audit_fn, compatible_fn)
    changed = False
    if apply and node == owner:
        codes = {item['code'] for item in checks}
        if codes == {'PROXY_UPDATE_PENDING'} and maintenance:
            changed = run(['sudo', '-n', sys.executable, '-B', str(SCRIPTS / 'install.py'), '--revision', revision], 1500)
        elif not codes.intersection({'PROXY_RECOVERY_REQUIRED', 'PROXY_SOURCE_DRIFT', 'PROXY_UPDATE_PENDING'}):
            for item in checks:
                if item['status'] != 'action-required':
                    continue
                if item['code'].startswith('PROXY_UNIT_'):
                    unit = item['expected'].removeprefix('Enabled and active ')
                    # Backup operations must not run before existing recovery confirmation.
                    if unit in TIMERS[2:] and not (root / 'state/secrets/recovery-confirmed').exists():
                        continue
                    changed = run(['sudo', '-n', 'systemctl', 'enable', '--now', unit]) or changed
                elif item['code'] == 'PROXY_ENDPOINT_DISABLED':
                    changed = run([sys.executable, '-B', str(root / 'scripts/public-endpoint'), 'enable']) or changed
        checks = inspect(root, node, owner, revision, run, audit_fn, compatible_fn)
    if node == owner and all(item['status'] == 'unchanged' for item in checks):
        verified = endpoint_check(root)
        checks.append(phase('PROXY_ENDPOINT_AUTH', 'unchanged' if verified else 'action-required',
                            'Verify the existing endpoint/client credential. Provider inference is a separate gate; routine checks never attempt management logins.',
                            'Authenticated public gateway client route',
                            'Verified' if verified else 'Endpoint or authentication unavailable', True))
    return {'version': 1, 'command': 'cliproxy fleet-sync', 'node': node,
            'owner': owner, 'ok': all(item['status'] == 'unchanged' for item in checks),
            'changed': changed, 'desiredRevision': revision, 'phases': checks,
            'durationMs': round((time.monotonic() - started) * 1000)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--definition', type=pathlib.Path, required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--maintenance', action='store_true')
    args = parser.parse_args()
    definition = json.loads(args.definition.read_text())
    owner = definition['proxy']['owner']
    if definition['version'] != 2 or definition['proxy']['endpoint'] != 'https://cli-proxy.chrisvouga.dev':
        raise ValueError('Invalid definition')
    if not re.fullmatch('[a-f0-9]{40}', args.revision) or not re.fullmatch('[a-z][a-z0-9-]{0,62}', args.node):
        raise ValueError('Invalid selection')
    if args.apply and args.node == owner and socket.gethostname().lower() != owner:
        raise ValueError('Singleton host identity does not match the declared owner; migration requires reviewed identity assignment and fencing')
    result = reconcile(ROOT, args.node, owner, args.revision, args.apply, args.maintenance)
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'version': 1, 'ok': False, 'code': 'PROXY_RECONCILE_FAILED',
                          'summary': 'Inspect reviewed definition, singleton identity and local permissions; raw errors withheld.'}))
        raise SystemExit(1) from None
