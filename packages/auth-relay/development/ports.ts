import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

type Probe = Bun.TCPSocketListener<undefined>;
function bind(port: number): Probe {
  return Bun.listen({
    hostname: '127.0.0.1',
    port,
    exclusive: true,
    socket: { data() {} },
  });
}
function reserve(previous?: string, stable = false): Probe | undefined {
  const value = Number(previous);
  if (Number.isInteger(value) && value > 1023 && value <= 65535) {
    try {
      return bind(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      // Colima may retain a forwarder after the container stops. Atlas stores
      // this URL in state; verify cluster ownership before schema operations.
      if (stable) return undefined;
    }
  }
  return bind(0);
}

/** Keep the persisted database endpoint stable; other dependency ports may move. */
export async function localPorts(
  cache: string
): Promise<Record<string, string>> {
  const path = join(cache, 'ports.json');
  let previous: Record<string, string> = {};
  try {
    previous = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const probes: Probe[] = [];
  try {
    const values: Record<string, string> = {};
    for (const key of ['DATABASE', 'BROKER', 'MOCK']) {
      const name = `AUTH_LOCAL_${key}_PORT`;
      const probe = reserve(previous[name], key === 'DATABASE');
      if (probe) probes.push(probe);
      values[name] = probe ? String(probe.port) : previous[name]!;
    }
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
    await rename(temporary, path);
    return values;
  } finally {
    for (const probe of probes) probe.stop(true);
  }
}
