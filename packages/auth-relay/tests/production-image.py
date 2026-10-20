"""Start the image exactly as deployed (single replica, local cache) against PostgreSQL.

The deploy only runs on main, so this proves in a pull request that the identity
image boots, becomes ready and survives a restart in both modes the rollout uses:
first deployment (create tables) and every later one (validate them).
"""
from pathlib import Path
import subprocess
import time
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[3]
NET, DB, KC, IMAGE = 'auth-relay-prod-net', 'auth-relay-prod-db', 'auth-relay-prod-kc', 'auth-relay-prod:local'
PORT = 18090


def docker(*args, check=True, capture=False):
    return subprocess.run(['docker', *args], cwd=ROOT, check=check, text=True, capture_output=capture)


def cleanup():
    docker('rm', '-f', KC, DB, check=False, capture=True)
    docker('network', 'rm', NET, check=False, capture=True)


def start(first_deployment):
    docker('rm', '-f', KC, check=False, capture=True)
    docker('run', '-d', '--name', KC, '--network', NET, '-p', f'127.0.0.1:{PORT}:8080',
           '-e', 'KC_DB_URL=jdbc:postgresql://' + DB + '/keycloak', '-e', 'KC_DB_USERNAME=keycloak', '-e', 'KC_DB_PASSWORD=test-only',
           '-e', f'KC_HOSTNAME=http://localhost:{PORT}', '-e', 'KC_HTTP_HOST=::', '-e', 'KC_PROXY_HEADERS=xforwarded',
           '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=admin', '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD=test-only',
           '-e', 'KC_SPI_CONNECTIONS_JPA__QUARKUS__MIGRATION_STRATEGY=' + ('update' if first_deployment else 'validate'),
           '-e', 'KC_SPI_CONNECTIONS_JPA__QUARKUS__INITIALIZE_EMPTY=' + ('true' if first_deployment else 'false'),
           IMAGE)


def wait_for(path, seconds=240):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=3) as response:
                if response.status == 200:
                    return
        except (URLError, OSError):
            pass
        time.sleep(2)
    raise TimeoutError(f'{path} never returned 200')


try:
    cleanup()
    # Same build arguments as the deploy workflow: none, so the local cache is used.
    docker('build', '-f', 'packages/auth-relay/Dockerfile.keycloak', '-t', IMAGE, 'packages/auth-relay')
    docker('network', 'create', NET)
    docker('run', '-d', '--name', DB, '--network', NET, '-e', 'POSTGRES_DB=keycloak', '-e', 'POSTGRES_USER=keycloak',
           '-e', 'POSTGRES_PASSWORD=test-only', '--health-cmd', 'pg_isready -U keycloak', '--health-interval', '2s', 'postgres:18.1-alpine')
    for _ in range(60):
        if docker('inspect', '-f', '{{.State.Health.Status}}', DB, capture=True).stdout.strip() == 'healthy':
            break
        time.sleep(2)
    for first_deployment in (True, False):
        start(first_deployment)
        wait_for('/health/ready')
        wait_for('/realms/master/.well-known/openid-configuration')
        print(f"PASS production image ready ({'first deployment' if first_deployment else 'restart with schema validation'})")
    logs = docker('logs', KC, capture=True)
    output = logs.stdout + logs.stderr
    for forbidden in ('JGroups', 'split-brain', 'ISPN000078'):
        assert forbidden not in output, f'unexpected clustering activity: {forbidden}'
    print('PASS no clustering activity with the local cache')
except Exception:
    subprocess.run(['docker', 'logs', '--tail', '60', KC], cwd=ROOT)
    raise
finally:
    cleanup()
