#!/usr/bin/env python3
"""Release gate: exact Git revision and closures, signature-verified in CI.

This uses authenticated GitHub artifacts rather than the HTTP proxy, so its
first deployment cannot deadlock waiting for a route that deploy adds later.
The installed live-image preflight independently requires public cache reads.
"""
import json
import subprocess
import tempfile
import time
from pathlib import Path

ROLES = ('ci', 'web', 'cache', 'netboot', 'devbox')


def capture(args):
    return subprocess.check_output(args, text=True, timeout=60).strip()


def validate(proof, revision, paths, public_key):
    if (proof.get('version') != 1 or proof.get('revision') != revision or
            proof.get('publicKey') != public_key or set(proof.get('paths', [])) != set(paths) or
            type(proof.get('signedPaths')) is not int or proof['signedPaths'] < len(set(paths))):
        raise ValueError('FLEET_CACHE_PROOF_INVALID: cache publication does not match this exact installer revision, closures and signing key.')


def main():
    revision = capture(['git', 'rev-parse', 'HEAD'])
    paths = [capture(['nix', 'eval', '--no-write-lock-file', '--raw',
        f'.#nixosConfigurations.{role}.config.system.build.toplevel']) for role in ROLES]
    metadata = json.loads(capture(['nix', 'eval', '--no-write-lock-file', '--json',
        '.#nixosConfigurations.ci.config.environment.etc."fleet/bootstrap.json".text']))
    # The public key is also evaluated from the flake, not parsed from Nix text.
    key = json.loads(metadata)['cachePublicKey']
    deadline = time.monotonic() + 3600
    while time.monotonic() < deadline:
        runs = json.loads(capture(['gh', 'run', 'list', '--workflow', 'fleet-cache.yml',
            '--commit', revision, '--limit', '20', '--json', 'databaseId,status,conclusion']))
        successful = next((run for run in runs if run['conclusion'] == 'success'), None)
        if successful:
            with tempfile.TemporaryDirectory(prefix='fleet-cache-proof-') as directory:
                capture(['gh', 'run', 'download', str(successful['databaseId']), '--name',
                    'fleet-cache-proof', '--dir', directory])
                validate(json.loads((Path(directory) / 'fleet-cache-proof.json').read_text()), revision, paths, key)
            print('FLEET_CACHE_PUBLISHED: exact revision and signed role closures verified. Public readiness remains a mandatory pre-wipe check.')
            return
        if runs and all(run['status'] == 'completed' for run in runs):
            raise RuntimeError('FLEET_CACHE_PUBLICATION_FAILED: the independent Fleet cache workflow failed. Repair its reported dependency and rerun it; this installer was not published.')
        print('FLEET_CACHE_WAIT: waiting for the independent signed-cache publisher.', flush=True)
        time.sleep(15)
    raise RuntimeError('FLEET_CACHE_WAIT_EXPIRED: exact-revision cache publication was not proved within one hour. This installer was not published.')


if __name__ == '__main__':
    main()
