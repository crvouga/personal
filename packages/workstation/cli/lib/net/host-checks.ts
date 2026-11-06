import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { join } from 'node:path';

import type { DoctorCheck } from '../doctor';
import { failCheck, passCheck, warnCheck } from './make-check';
import { workstationRoot } from '../paths';
import { healthChecks, parseProbe } from './health';
import { expandHome, shortName, type NetHost } from './inventory';
import { lastLine, run } from './run';
import {
  normalizeDnsName,
  tailscalePing,
  type TailscaleStatus,
} from './tailscale';
import { fetchT3Environment } from './t3';

export type HostContext = {
  readonly tailscaleBin: string | null;
  readonly tailscale: TailscaleStatus | null;
  readonly localT3Version: string | null;
  readonly tries: number;
};

type Check = DoctorCheck;

const SSH_OPTS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ConnectionAttempts=1',
];

async function tailscaleChecks(
  ctx: HostContext,
  host: NetHost
): Promise<Check[]> {
  if (ctx.tailscaleBin === null || ctx.tailscale === null) return [];
  const want = normalizeDnsName(host.tailscaleName);
  const peer = ctx.tailscale.peers.find((p) => p.dnsName === want);
  if (peer === undefined) {
    return [
      failCheck(
        'ts-peer',
        'Tailscale peer',
        `${want} is not in this tailnet`,
        'Sign that machine into Tailscale with the same account.'
      ),
    ];
  }
  if (!peer.online) {
    return [
      failCheck(
        'ts-peer',
        'Tailscale peer',
        'Tailscale says the machine is offline',
        'Wake it up and make sure Tailscale is running on it.'
      ),
    ];
  }
  const ping = await tailscalePing(
    ctx.tailscaleBin,
    shortName(host.tailscaleName)
  );
  if (!ping.ok) {
    return [
      failCheck(
        'ts-ping',
        'Tailscale ping',
        ping.detail || 'no reply',
        'Restart Tailscale on that machine.'
      ),
    ];
  }
  if (ping.viaRelay) {
    return [
      warnCheck(
        'ts-ping',
        'Tailscale ping',
        `only via a DERP relay (${ping.latency}); slower and less stable`,
        "Check firewall/NAT on that machine; run 'tailscale netcheck' there."
      ),
    ];
  }
  return [
    passCheck(
      'ts-ping',
      'Tailscale ping',
      `direct connection (${ping.latency})`
    ),
  ];
}

async function dnsCheck(host: NetHost): Promise<Check> {
  try {
    const { address } = await lookup(host.tailscaleName, { family: 4 });
    return passCheck('dns', 'MagicDNS', `${host.tailscaleName} → ${address}`);
  } catch {
    return failCheck(
      'dns',
      'MagicDNS',
      `${host.tailscaleName} does not resolve`,
      'Enable MagicDNS in the Tailscale app / admin console.'
    );
  }
}

function tcpOpen(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host, () => done(true));
  });
}

async function portCheck(host: NetHost): Promise<Check> {
  const open = await tcpOpen(host.tailscaleName, host.sshPort, 5000);
  return open
    ? passCheck('ssh-port', 'SSH port', `${host.sshPort} is open`)
    : failCheck(
        'ssh-port',
        'SSH port',
        `${host.sshPort} is closed`,
        'Start sshd on that machine (for WSL: is the distro running?).'
      );
}

type LoginStats = {
  ok: number;
  slow: number;
  fastestMs: number;
  lastError: string;
};

async function loginStats(host: NetHost, tries: number): Promise<LoginStats> {
  const stats: LoginStats = {
    ok: 0,
    slow: 0,
    fastestMs: Infinity,
    lastError: '',
  };
  for (let i = 0; i < tries; i++) {
    const r = await run('ssh', [...SSH_OPTS, host.alias, 'echo ws-net-ok'], {
      timeoutMs: 25_000,
    });
    if (!r.stdout.includes('ws-net-ok')) {
      stats.lastError = r.timedOut ? 'timed out' : lastLine(r.stderr);
      continue;
    }
    stats.ok++;
    stats.fastestMs = Math.min(stats.fastestMs, r.ms);
    if (r.ms > 5000) stats.slow++;
  }
  return stats;
}

function loginCheck(s: LoginStats, tries: number): Check {
  if (s.ok === 0) {
    return failCheck(
      'ssh-login',
      'SSH login',
      `${tries}/${tries} tries failed: ${s.lastError}`,
      "'timed out during banner exchange' usually means the machine is overloaded; see CPU load."
    );
  }
  if (s.ok < tries)
    return warnCheck(
      'ssh-login',
      'SSH login',
      `flaky: ${s.ok}/${tries} worked; last error: ${s.lastError}`
    );
  if (s.slow > 0)
    return warnCheck(
      'ssh-login',
      'SSH login',
      `slow: ${s.slow}/${tries} logins took >5s`
    );
  return passCheck(
    'ssh-login',
    'SSH login',
    `${s.ok}/${tries}, fastest ${s.fastestMs}ms`
  );
}

async function fullNameCheck(host: NetHost): Promise<Check> {
  const target = `${host.user}@${host.tailscaleName}`;
  const r = await run('ssh', [...SSH_OPTS, target, 'echo ws-net-ok'], {
    timeoutMs: 25_000,
  });
  if (r.stdout.includes('ws-net-ok')) {
    return passCheck(
      'ssh-fullname',
      'SSH by full name (VS Code path)',
      `${target} works`
    );
  }
  return warnCheck(
    'ssh-fullname',
    'SSH by full name (VS Code path)',
    `${target} fails: ${r.timedOut ? 'timed out' : lastLine(r.stderr)}. VS Code Remote-SSH hits the same error.`,
    `Run \`personal workstation net fix\`, or connect VS Code to '${host.alias}'.`
  );
}

function keyCheck(host: NetHost): Check {
  const path = expandHome(host.identityFile);
  return existsSync(path)
    ? passCheck('ssh-key', 'SSH key', host.identityFile)
    : failCheck(
        'ssh-key',
        'SSH key',
        `${host.identityFile} is missing on this machine`,
        `Copy the key here (it is never committed), or ssh-copy-id a new one to ${host.alias}.`
      );
}

async function machineHealth(host: NetHost): Promise<Check[]> {
  if (host.os === 'windows') return [];
  const script = readFileSync(
    join(workstationRoot(), 'net/remote-probe.sh'),
    'utf8'
  );
  const r = await run('ssh', [...SSH_OPTS, host.alias, 'sh -s'], {
    timeoutMs: 30_000,
    input: script,
  });
  const checks = healthChecks(parseProbe(r.stdout), host.alias);
  return checks.length > 0
    ? checks
    : [
        warnCheck(
          'health',
          'Machine health',
          'could not read load / memory / disk'
        ),
      ];
}

async function t3Check(ctx: HostContext, host: NetHost): Promise<Check> {
  const url = `http://${host.tailscaleName}:${host.t3Port}`;
  const env = await fetchT3Environment(url);
  if (env === null) {
    return failCheck(
      't3',
      'T3 server',
      `not reachable at ${url}`,
      `Open T3 Code on ${host.alias} and make sure it listens on the network, not only 127.0.0.1.`
    );
  }
  if (ctx.localT3Version !== null && env.serverVersion !== ctx.localT3Version) {
    return warnCheck(
      't3',
      'T3 server',
      `runs ${env.serverVersion}; this machine runs ${ctx.localT3Version}`,
      `Update T3 Code on ${host.alias} (or here).`
    );
  }
  return passCheck('t3', 'T3 server', `${env.label} v${env.serverVersion}`);
}

/** Every check for one remote machine, in dependency order. */
export async function checkHost(
  ctx: HostContext,
  host: NetHost
): Promise<Check[]> {
  if (ctx.tailscale?.selfDnsName === normalizeDnsName(host.tailscaleName)) {
    return [
      passCheck(
        'self',
        'This machine',
        'skipped remote checks (this is the machine running ws)'
      ),
    ];
  }
  const [ts, dns, port] = await Promise.all([
    tailscaleChecks(ctx, host),
    dnsCheck(host),
    portCheck(host),
  ]);
  const stats = await loginStats(host, ctx.tries);
  const [fullName, health, t3] = await Promise.all([
    fullNameCheck(host),
    stats.ok > 0 ? machineHealth(host) : Promise.resolve([]),
    t3Check(ctx, host),
  ]);
  return [
    ...ts,
    dns,
    port,
    loginCheck(stats, ctx.tries),
    fullName,
    keyCheck(host),
    ...health,
    t3,
  ];
}
