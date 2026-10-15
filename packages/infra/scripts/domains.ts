#!/usr/bin/env bun
/** Read-only inventory and public observations; no migration execution. */
import { join } from 'node:path';
import { errorMessage } from '../lib/health/context.js';
import { listZones } from '../lib/domains/cloudflare.js';
import { discover } from '../lib/domains/discover.js';
import { domainContext } from '../lib/domains/runtime.js';

async function main(): Promise<number> {
  const [command = 'help', ...options] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) {
    console.log('Usage: bun domains <inventory | discover> [--json]\nRead-only observations. Registrations remain at Squarespace; migration is cancelled.');
    return 0;
  }
  if (!['inventory', 'discover'].includes(command) || options.some((value) => value !== '--json')) throw new Error('Domain migration cancelled; only read-only inventory and discover are available');
  const ctx = await domainContext(join(import.meta.dirname, '..', '..', '..'));
  if (command === 'discover') {
    console.log(JSON.stringify(await discover(ctx), null, 2));
    return 0;
  }
  const zones = await listZones(ctx);
  const configured = Object.entries(ctx.config.domains ?? {});
  const expected = configured.filter(([name, spec]) => spec.manage_zone || name === ctx.config.zone).map(([name]) => name);
  const untrackedCloudflare = zones.filter((zone) => !expected.includes(zone.name)).map((zone) => zone.name);
  console.log(JSON.stringify({ registrar: 'Squarespace', configured: configured.map(([name]) => name), cloudflare: zones, untrackedCloudflare }, null, 2));
  return untrackedCloudflare.length ? 1 : 0;
}
main().then((code) => { process.exitCode = code; }, (error) => { console.error(errorMessage(error)); process.exitCode = 1; });
