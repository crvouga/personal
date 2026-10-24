"""Build, exercise and remove the isolated local compatibility fixture."""
from pathlib import Path
import os
import socket
import subprocess
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
COMPOSE = ['docker', 'compose', '-p', 'auth-relay-compatibility', '-f', str(HERE / 'compose.yml')]


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


# Fail before touching our fixture when another application owns a test port.
for port in [3000, 5173, int(os.environ.get('AUTH_TEST_PORT_C', '8080')), 3443, 5443, 19080]:
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError as error:
            raise RuntimeError(f'Test port {port} is occupied; keep the application running and use an isolated test host or an explicitly recorded AUTH_TEST_PORT_C override') from error

try:
    run('bun', 'run', '--cwd', 'packages/auth-relay', 'build')
    run(*COMPOSE, 'down', '--volumes')
    if os.environ.get('AUTH_TEST_PREBUILT') == '1':
        # CI's Bake graph builds these exact sources with persistent caches.
        # Missing images are an error, never an implicit fixture fallback.
        run('docker', 'image', 'inspect', '--format', '{{.Id}}', 'auth-relay-test:local', 'auth-relay-fixture:local', 'auth-relay-mock:local')
    else:
        run('docker', 'build', '--build-arg', 'KC_CACHE=ispn', '-f', 'packages/auth-relay/Dockerfile.keycloak', '-t', 'auth-relay-test:local', 'packages/auth-relay')
        run(*COMPOSE, 'build', 'broker', 'mock')
    run(*COMPOSE, 'up', '-d', '--wait', '--wait-timeout', '180')
    for port in (18080, 18081):
        deadline = time.monotonic() + 180
        while True:
            try:
                with urlopen(f'http://localhost:{port}/realms/compatibility/.well-known/openid-configuration', timeout=2) as response:
                    if response.status == 200:
                        break
            except Exception:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError('Broker readiness/discovery timeout')
            time.sleep(1)
    run('bun', 'packages/auth-relay/tests/console.ts')
    run('node', 'packages/auth-relay/tests/e2e.mjs')
except Exception:
    subprocess.run([*COMPOSE, 'logs', '--tail', '15'], cwd=ROOT)
    raise
finally:
    subprocess.run([*COMPOSE, 'down', '--volumes'], cwd=ROOT, check=True)
