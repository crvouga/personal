"""Read-only evidence that an installed node is integrated, not merely online."""
import json
import os
import re
import time


def document(path):
    try:
        with path.open() as stream:
            return json.loads(stream.read(65537))
    except (OSError, ValueError):
        return None


def issues(paths, identity, run, credential, settings):
    try:
        return collect_issues(paths, identity, run, credential, settings)
    except Exception:
        # Diagnostics must never prevent the heartbeat that exposes a problem.
        return ['FLEET_READINESS_FAILED: integration readiness could not be verified; the agent will retry.']


def collect_issues(paths, identity, run, credential, settings):
    metadata = document(paths.etc / 'bootstrap.json')
    if not isinstance(metadata, dict) or metadata.get('version') != 1:
        return ['FLEET_READINESS_UNKNOWN: this image does not report integration readiness.']
    result = list(metadata.get('blocked') or [])
    if not credential:
        result.append('FLEET_RECOVERY_CREDENTIAL_MISSING: automatic re-enrollment is unavailable.')
    if settings.get('sync.paused') is True:
        result.append('FLEET_UPDATES_PAUSED: automatic updates are paused in Fleet settings.')
    code, timer = run([paths.systemctl, 'is-active', 'fleet-sync.timer'], 5)
    if code or timer.strip() != 'active':
        result.append('FLEET_UPDATE_TIMER_INACTIVE: the update timer is not running.')
    try:
        revision = (paths.etc / 'revision').read_text().strip()
        success = (paths.state.parent / 'sync/last-success').read_text().strip()
        if not revision or revision == 'unknown' or revision != success:
            result.append('FLEET_UPDATE_CHECK_PENDING: waiting for a successful update/cache check of this revision.')
    except OSError:
        result.append('FLEET_UPDATE_CHECK_PENDING: waiting for the first successful automatic update check.')
    github = metadata.get('github')
    if github:
        result.extend(github_issues(paths, identity, run, github, settings))
    return result[:12]


def github_issues(paths, identity, run, github, settings):
    if settings.get('runners.enabled') is False or settings.get('runners.cordoned') is True:
        return ['FLEET_RUNNERS_DISABLED: runners are disabled or cordoned in Fleet settings.']
    try:
        slots = int((paths.run / 'slot-count').read_text().strip())
    except (OSError, ValueError):
        return ['FLEET_RUNNERS_STARTING: runner capacity has not been determined.']
    scope = github.get('scope')
    repositories = github.get('repositories') or []
    if not 1 <= slots <= 64 or scope not in ('organization', 'repository') or (scope == 'repository' and not repositories):
        return ['FLEET_GITHUB_SCOPE_INVALID: runner registration targets are not configured correctly.']
    prefix = identity.get('runner_prefix', identity['hostname'])
    targets = {}
    for slot in range(1, slots + 1):
        try:
            assigned = (paths.run / 'assign-used' / f'slot-{slot}').read_text().strip()
        except OSError:
            assigned = ''
        target_scope = 'repository' if assigned else scope
        target = assigned or (repositories[(slot - 1) % len(repositories)] if scope == 'repository' else github.get('organization'))
        valid = r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+' if target_scope == 'repository' else r'[A-Za-z0-9_.-]+'
        if not isinstance(target, str) or not re.fullmatch(valid, target):
            return ['FLEET_GITHUB_SCOPE_INVALID: runner registration targets are not configured correctly.']
        targets.setdefault((target_scope, target), set()).add(f'{prefix}-slot-{slot}')
    code, states = run([paths.systemctl, 'is-active', *[f'github-runner-slot-{n}.service' for n in range(1, slots + 1)]], 5)
    if code or states.splitlines().count('active') != slots:
        return ['FLEET_RUNNERS_STARTING: expected runner services are not all active.']
    cache_file = paths.state / 'github-readiness.json'
    cached = document(cache_file)
    evidence = cached.get('targets', {}) if isinstance(cached, dict) and cached.get('prefix') == prefix else {}
    if not isinstance(evidence, dict):
        evidence = {}
    expected = {target_scope + ':' + target: names for (target_scope, target), names in targets.items()}
    def valid_names(value, allowed):
        return isinstance(value, list) and len(value) <= 64 and all(isinstance(name, str) and name in allowed for name in value)
    now = time.time()
    evidence = {key: value for key, value in evidence.items() if key in expected and isinstance(value, dict)
                and type(value.get('checked')) in (int, float) and 0 <= now - value['checked'] <= 600
                and valid_names(value.get('onlineNames'), expected[key])}
    deadline = time.monotonic() + 10
    # Oldest/unverified targets go first. Persist each bounded batch so many
    # assigned repositories cannot make the same first request starve the rest.
    ordered = sorted(targets, key=lambda pair: evidence.get(':'.join(pair), {}).get('checked', 0))
    problem = None
    for target_scope, target in ordered:
        key = target_scope + ':' + target
        if now - evidence.get(key, {}).get('checked', 0) < 60:
            continue
        remaining = int(deadline - time.monotonic())
        if remaining < 1:
            break
        code, out = run(['/run/current-system/sw/bin/runner-control', 'status', target_scope, target, str(github['appId']),
            str(github['installationId']), str(paths.run.parent / 'secrets/github-app-key'), prefix], remaining)
        try:
            report = json.loads(out)
            names = report['onlineNames']
            if code or not valid_names(names, {f'{prefix}-slot-{slot}' for slot in range(1, 65)}):
                raise ValueError()
            # Keep only the slots assigned here. Old registrations and another
            # target's extra slots cannot substitute for a missing runner.
            evidence[key] = {'onlineNames': sorted(set(names) & expected[key]), 'checked': time.time()}
        except (ValueError, KeyError, TypeError):
            evidence.pop(key, None)
            problem = 'FLEET_GITHUB_UNAVAILABLE: GitHub runner registration/online status could not be verified; retrying automatically.'
            break
    paths.state.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = cache_file.with_suffix('.new')
    temporary.write_text(json.dumps({'prefix': prefix, 'targets': evidence}))
    os.replace(temporary, cache_file)
    if problem:
        return [problem]
    if set(evidence) != set(expected):
        return ['FLEET_GITHUB_CHECK_PENDING: bounded registration checks are progressing across assigned targets; retrying automatically.']
    online = sum(len(set(evidence[key]['onlineNames']) & names) for key, names in expected.items())
    if online < slots:
        return [f'FLEET_GITHUB_RUNNERS_PENDING: GitHub reports {online} of {slots} expected runners online at their assigned targets.']
    return []
