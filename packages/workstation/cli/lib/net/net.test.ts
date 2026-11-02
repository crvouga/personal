import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { launchdPlist } from '../platform/launchd';
import { systemdUnits } from '../platform/systemd-user';
import { diskCheck, healthChecks, parseProbe } from './health';
import { failureKeys, notificationFor } from './history';
import {
  expandHome,
  inventoryPath,
  parseInventory,
  shortName,
  type NetCheck,
  type NetHost,
} from './inventory';
import { findOnPath, lastLine } from './run';
import { renderSshBlock, SSH_BLOCK_END, upsertSshBlock } from './ssh-config';
import { parsePing, parseTailscaleStatus } from './tailscale';
import { parseT3Environment } from './t3';
import { mergeVscodeSettings } from './vscode';

const HOST: NetHost = {
  alias: 'box',
  tailscaleName: 'box-1.tail0.ts.net',
  sshPort: 2222,
  user: 'me',
  identityFile: '~/.ssh/id_box',
  os: 'linux',
  t3Port: 3773,
};

test('checked-in inventory parses', () => {
  const hosts = parseInventory(readFileSync(inventoryPath(), 'utf8'));
  expect(hosts.length).toBeGreaterThan(0);
  expect(new Set(hosts.map((h) => h.alias)).size).toBe(hosts.length);
});

test('parseInventory rejects bad hosts', () => {
  expect(() => parseInventory('{"hosts":[{"alias":"x"}]}')).toThrow();
  expect(() => parseInventory('{}')).toThrow();
  const bad = { hosts: [{ ...HOST, os: 'beos' }] };
  expect(() => parseInventory(JSON.stringify(bad))).toThrow(/os/);
});

test('expandHome / shortName', () => {
  expect(expandHome('~/.ssh/k', '/h')).toBe('/h/.ssh/k');
  expect(expandHome('/abs', '/h')).toBe('/abs');
  expect(shortName('box-1.tail0.ts.net')).toBe('box-1');
});

test('parseTailscaleStatus reads state, self and peers', () => {
  const json = JSON.stringify({
    BackendState: 'Running',
    Self: { DNSName: 'me.tail0.ts.net.' },
    Health: ['dns broken'],
    Peer: {
      k1: { DNSName: 'Box-1.tail0.ts.net.', Online: true },
      k2: { DNSName: 'off.tail0.ts.net.', Online: false },
    },
  });
  const s = parseTailscaleStatus(json);
  expect(s?.backendState).toBe('Running');
  expect(s?.selfDnsName).toBe('me.tail0.ts.net');
  expect(s?.health).toEqual(['dns broken']);
  expect(s?.peers).toEqual([
    { dnsName: 'box-1.tail0.ts.net', online: true },
    { dnsName: 'off.tail0.ts.net', online: false },
  ]);
  expect(parseTailscaleStatus('not json')).toBeNull();
});

test('parsePing distinguishes direct, relay and failure', () => {
  const direct = parsePing(
    'pong from box (100.1.2.3) via 192.168.0.5:41641 in 10ms'
  );
  expect(direct).toMatchObject({ ok: true, viaRelay: false, latency: '10ms' });
  const relay = parsePing('pong from box (100.1.2.3) via DERP(lax) in 35ms');
  expect(relay).toMatchObject({ ok: true, viaRelay: true, latency: '35ms' });
  const none = parsePing('ping "box" timed out\n');
  expect(none).toMatchObject({ ok: false, detail: 'ping "box" timed out' });
});

test('parseProbe + health thresholds', () => {
  const s = parseProbe(
    'ncpu=32\nload=94.2\nmemfree=14\nswap=100\ndiskmb=900000\njunk=1\nload2=x'
  );
  expect(s).toEqual({
    ncpu: 32,
    load: 94.2,
    memFreePct: 14,
    swapPct: 100,
    diskMb: 900000,
  });
  const sev = healthChecks(s, 'box').map((c) => [c.id, c.severity]);
  expect(sev).toEqual([
    ['load', 'fail'],
    ['memory', 'fail'],
    ['disk', 'pass'],
  ]);
  expect(
    healthChecks(parseProbe('ncpu=12\nload=13\nmemfree=50\nswap=10'), 'b').map(
      (c) => c.severity
    )
  ).toEqual(['warn', 'pass']);
  expect(diskCheck(163)?.severity).toBe('fail');
  expect(diskCheck(5000)?.severity).toBe('warn');
  expect(diskCheck(undefined)).toBeNull();
  expect(healthChecks(parseProbe(''), 'b')).toEqual([]);
});

test('ssh block covers alias, full and short name with the host key and port', () => {
  const block = renderSshBlock([HOST]);
  expect(block).toContain('Host box box-1.tail0.ts.net box-1\n');
  expect(block).toContain('    Port 2222\n');
  expect(block).toContain('    IdentityFile ~/.ssh/id_box\n');
  expect(block.trimEnd().endsWith(SSH_BLOCK_END)).toBe(true);
});

test('upsertSshBlock keeps user config, replaces managed + legacy blocks', () => {
  const user = 'Include ~/.ssh/other\nHost a\n    User x\n';
  const once = upsertSshBlock(user, renderSshBlock([HOST]));
  expect(once.startsWith(user.trimEnd())).toBe(true);
  expect(upsertSshBlock(once, renderSshBlock([HOST]))).toBe(once);
  const legacy = `${user}\n# devnet:begin old\nHost z\n# devnet:end\n`;
  const migrated = upsertSshBlock(legacy, renderSshBlock([HOST]));
  expect(migrated).not.toContain('devnet:begin');
  expect(migrated).not.toContain('Host z');
  expect(upsertSshBlock('', 'B')).toBe('B\n');
});

test('mergeVscodeSettings adds platforms + timeout, keeps other keys, refuses JSONC', () => {
  const r = mergeVscodeSettings('{"a":1,"remote.SSH.connectTimeout":90}', [
    HOST,
  ]);
  if (!r.ok) throw new Error(r.reason);
  const parsed: unknown = JSON.parse(r.text);
  expect(parsed).toMatchObject({
    a: 1,
    'remote.SSH.connectTimeout': 90,
    'remote.SSH.remotePlatform': {
      box: 'linux',
      'box-1': 'linux',
      'box-1.tail0.ts.net': 'linux',
    },
  });
  const again = mergeVscodeSettings(r.text, [HOST]);
  expect(again.ok && again.changed).toBe(false);
  expect(mergeVscodeSettings('{\n // c\n}', [HOST]).ok).toBe(false);
  expect(mergeVscodeSettings('', [HOST]).ok).toBe(true);
});

test('parseT3Environment', () => {
  expect(parseT3Environment({ label: 'Box', serverVersion: '1.2' })).toEqual({
    label: 'Box',
    serverVersion: '1.2',
  });
  expect(parseT3Environment({ label: 'Box' })).toBeNull();
  expect(parseT3Environment('nope')).toBeNull();
});

function netCheck(
  group: string,
  id: string,
  severity: NetCheck['severity']
): NetCheck {
  return { group, id, label: id, severity, detail: '' };
}

test('notificationFor only fires on change', () => {
  const failing = [
    netCheck('box (x)', 'disk', 'fail'),
    netCheck('box (x)', 'dns', 'pass'),
  ];
  const keys = failureKeys(failing);
  expect(keys).toEqual(['box (x) :: disk']);
  expect(notificationFor([], failing)).toMatchObject({
    kind: 'error',
    message: 'box: disk',
  });
  expect(notificationFor(keys, failing)).toBeNull();
  expect(
    notificationFor(keys, [netCheck('box (x)', 'disk', 'pass')])
  ).toMatchObject({ kind: 'finished' });
  expect(notificationFor([], [])).toBeNull();
});

test('scheduled job renderers escape and include env', () => {
  const job = {
    label: 'dev.test.job',
    command: ['/h/.local/bin/ws', 'net', 'check', 'a&b'],
    intervalSeconds: 300,
    logDir: '/h/logs',
    env: { PATH: '/a b:/c' },
  };
  const plist = launchdPlist(job);
  expect(plist).toContain('<string>a&amp;b</string>');
  expect(plist).toContain('<key>PATH</key><string>/a b:/c</string>');
  expect(plist).toContain('<integer>300</integer>');
  const { service, timer } = systemdUnits(job);
  expect(service).toContain('ExecStart=/h/.local/bin/ws net check "a&b"');
  expect(service).toContain('Environment="PATH=/a b:/c"');
  expect(timer).toContain('OnUnitActiveSec=300');
});

test('lastLine / findOnPath', () => {
  expect(lastLine('a\n\n  b  \n\n')).toBe('b');
  expect(lastLine('')).toBe('');
  expect(findOnPath('definitely-not-a-real-binary-xyz', '/usr/bin')).toBeNull();
  expect(findOnPath('sh', '/bin')).toBe('/bin/sh');
});
