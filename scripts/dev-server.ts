/** Allocate a workspace-local development port, then supervise one server.
 * Production entry points never use this launcher.
 */
export {};
const [name, defaultPort, ...command] = process.argv.slice(2);
if (!name || !defaultPort || command.length === 0) {
  throw new Error('Usage: dev-server.ts NAME DEFAULT_PORT COMMAND [ARGS...]');
}
const setting = `${name.toUpperCase().replaceAll('-', '_')}_PORT`;
const first = Number(process.env[setting] ?? defaultPort);
if (!Number.isInteger(first) || first < 1024 || first > 65000) {
  throw new Error(`${setting} must be an integer between 1024 and 65000`);
}
function availablePort(start: number): number {
  for (let port = start; port < start + 200; port++) {
    try {
      for (const hostname of ['127.0.0.1', '0.0.0.0', '::1'])
        probePort(hostname, port);
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`No free development port near ${start}`);
}
function probePort(hostname: string, port: number): void {
  try {
    const probe = Bun.listen({
      hostname,
      port,
      exclusive: true,
      socket: { data() {} },
    });
    probe.stop(true);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      hostname === '::1' &&
      ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(code ?? '')
    )
      return;
    throw error;
  }
}
const port = availablePort(first);
// Astro accepts its port through the CLI; Bun servers read PORT.
const args = command.map((argument) =>
  argument.replaceAll('{port}', String(port))
);
process.stdout.write(`${name}: http://localhost:${port}\n`);
const child = Bun.spawn(args, {
  env: { ...process.env, PORT: String(port) },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
let stopping = false;
function stop(signal: 'SIGINT' | 'SIGTERM'): void {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
const exit = await child.exited;
process.exitCode = stopping ? 0 : exit;
