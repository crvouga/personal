#!/usr/bin/env python3
"""Fleet singleton reconciliation: the manager hosts the proxy, workers are clients."""
import sys
sys.dont_write_bytecode = True

import argparse
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import time

SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import cliproxy_host

ENDPOINT = 'https://cli-proxy.chrisvouga.dev'
DECOMMISSION = ('Workers never host singletons. Fence and decommission this local proxy with '
                'packages/cliproxy-fleet/docs/migration.md (disable timers, drain, stop, disable, '
                'final backup); fleet-sync never stops it automatically.')


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
        # Provenance and unit links only: loaded/active state is reported per unit below.
        manifest, errors = module.audit(root, run=lambda argv: True)
        return not errors, manifest.get('revision')
    except Exception:
        return False, None


def phase(code, status, summary, expected, observed, retryable=False):
    return {'id': 'proxy:' + code.lower().replace('_', '-'), 'code': code,
            'status': status, 'summary': summary, 'expected': expected,
            'observed': observed, 'retryable': retryable,
            'actionRequired': status in ('failed', 'action-required'),
            'scope': 'node', 'remedy': {'owner': 'cliproxy-fleet', 'action': summary}}


def unit_code(unit):
    return 'PROXY_UNIT_' + re.sub('[^A-Z0-9]', '_', unit.upper())


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


def inspect_worker(root, backend, run):
    """Client role. A local host is reported, never stopped."""
    live = [unit for unit in backend.units if any(backend.state(unit, run))]
    if live:
        return [phase('PROXY_DUPLICATE_OWNER', 'action-required', DECOMMISSION,
                      'No proxy host on workers', 'Active or enabled local host: ' + ', '.join(live))]
    if (root / 'INSTALLATION.json').exists():
        return [phase('PROXY_DECOMMISSION_PENDING', 'action-required',
                      'A fenced proxy installation (with private state) remains on this worker. After the manager '
                      'cutover is verified, remove it as described in packages/cliproxy-fleet/docs/migration.md.',
                      'No proxy installation on workers', 'Stopped local installation present')]
    return [phase('PROXY_CLIENT_ROLE', 'unchanged', 'Worker; the proxy runs on the manager.',
                  'No proxy host on workers', 'No active host')]


def inspect(root, node, owner, revision, run=execute, audit_fn=audit, compatible_fn=equivalent_source,
            backend=None, identity=None):
    backend = backend or cliproxy_host.backend()
    if node != owner:
        return inspect_worker(root, backend, run)
    if backend.name != 'launchd':
        return [phase('PROXY_PLATFORM_MISMATCH', 'action-required',
                      'The manager hosts the proxy on macOS with launchd; run fleet-sync for the manager on the manager.',
                      'macOS launchd owner backend', backend.name)]
    if identity is not None and identity != owner:
        return [phase('PROXY_IDENTITY_MISMATCH', 'action-required',
                      'This host is not the declared manager; changing the manager requires reviewed identity assignment and fencing.',
                      owner, identity)]
    if not (root / 'state/runtime/config.yaml').is_file():
        return [phase('PROXY_RECOVERY_REQUIRED', 'action-required',
                      'Use the existing encrypted recovery flow after fencing the previous owner; never initialize a second provider identity.',
                      'Recovered runtime state on the manager', 'Runtime cache missing')]
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
    for unit in backend.units:
        active, enabled = backend.state(unit, run)
        checks.append(phase(unit_code(unit),
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


def reconcile(root, node, owner, revision, apply=False, maintenance=False, run=execute, audit_fn=audit,
              endpoint_check=endpoint_health, compatible_fn=equivalent_source, backend=None, identity=None):
    started = time.monotonic()
    backend = backend or cliproxy_host.backend()
    checks = inspect(root, node, owner, revision, run, audit_fn, compatible_fn, backend, identity)
    changed = False
    codes = {item['code'] for item in checks}
    blocked = {'PROXY_PLATFORM_MISMATCH', 'PROXY_IDENTITY_MISMATCH', 'PROXY_RECOVERY_REQUIRED',
               'PROXY_SOURCE_DRIFT', 'PROXY_UPDATE_PENDING'}
    if apply and node == owner and not codes & (blocked - {'PROXY_UPDATE_PENDING'}):
        if codes == {'PROXY_UPDATE_PENDING'} and maintenance:
            changed = run(backend.install(sys.executable, SCRIPTS, revision), 1500)
        elif not codes & blocked:
            for item in checks:
                if item['status'] != 'action-required':
                    continue
                if item['code'].startswith('PROXY_UNIT_'):
                    unit = item['expected'].removeprefix('Enabled and active ')
                    # Backup operations must not run before existing recovery confirmation.
                    if unit in backend.recovery_gated and not (root / 'state/secrets/recovery-confirmed').exists():
                        continue
                    for command in backend.enable(unit):
                        changed = run(command) or changed
                elif item['code'] == 'PROXY_ENDPOINT_DISABLED':
                    changed = run([sys.executable, '-B', str(root / 'scripts/public-endpoint'), 'enable']) or changed
        checks = inspect(root, node, owner, revision, run, audit_fn, compatible_fn, backend, identity)
    if node == owner and all(item['status'] == 'unchanged' for item in checks):
        verified = endpoint_check(root)
        checks.append(phase('PROXY_ENDPOINT_AUTH', 'unchanged' if verified else 'action-required',
                            'Verify the existing endpoint/client credential. Provider inference is a separate gate; routine checks never attempt management logins.',
                            'Authenticated public gateway client route',
                            'Verified' if verified else 'Endpoint or authentication unavailable', True))
    return {'version': 1, 'command': 'cliproxy fleet-sync', 'node': node,
            'role': 'manager' if node == owner else 'worker', 'owner': owner,
            'backend': backend.name, 'ok': all(item['status'] == 'unchanged' for item in checks),
            'changed': changed, 'desiredRevision': revision, 'phases': checks,
            'durationMs': round((time.monotonic() - started) * 1000)}


def roles(definition):
    """Validate definition v3 and return (manager id, worker ids)."""
    manager = definition['manager']
    if (definition.get('version') != 3 or manager.get('os') != 'macOS'
            or definition['services']['proxy']['endpoint'] != ENDPOINT):
        raise ValueError('Invalid definition')
    workers = {worker['id'] for worker in definition['workers']}
    if manager['id'] in workers:
        raise ValueError('The manager is never a worker')
    return manager['id'], workers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--definition', type=pathlib.Path, required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--maintenance', action='store_true')
    args = parser.parse_args()
    owner, workers = roles(json.loads(args.definition.read_text()))
    if not re.fullmatch('[a-f0-9]{40}', args.revision) or args.node not in workers | {owner}:
        raise ValueError('Invalid selection')
    backend = cliproxy_host.backend()
    identity = cliproxy_host.local_node_id() if args.node == owner else None
    result = reconcile(cliproxy_host.default_root(), args.node, owner, args.revision, args.apply,
                       args.maintenance, backend=backend, identity=identity)
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'version': 1, 'ok': False, 'code': 'PROXY_RECONCILE_FAILED',
                          'summary': 'Inspect reviewed definition, singleton identity and local permissions; raw errors withheld.'}))
        raise SystemExit(1) from None
