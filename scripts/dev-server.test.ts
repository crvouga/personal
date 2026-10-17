import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

const launcher = resolve(import.meta.dir, 'dev-server.ts');

async function occupiedPort(hostname: string) {
  while (true) {
    const server = Bun.serve({
      hostname,
      port: 0,
      fetch: () => new Response('unrelated server'),
    });
    const port = server.port;
    if (port !== undefined && port < 64000) return { server, port };
    await server.stop(true);
  }
}

test.each(['127.0.0.1', '0.0.0.0'])(
  'dev launcher avoids an occupied %s port, passes the chosen port and shuts down cleanly',
  async (hostname) => {
    const occupied = await occupiedPort(hostname);
    const child = Bun.spawn(
      [
        process.execPath,
        launcher,
        'fixture',
        String(occupied.port),
        process.execPath,
        '-e',
        `
    process.on('SIGINT', () => process.exit(130));
    Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT),fetch:()=>new Response(process.env.PORT + ':' + process.argv.at(-1))});
  `,
        '{port}',
      ],
      {
        env: { ...process.env, FIXTURE_PORT: String(occupied.port), PORT: '1' },
        stdout: 'pipe',
        stderr: 'inherit',
      }
    );
    const limit = setTimeout(() => child.kill('SIGKILL'), 7000);
    try {
      const reader = child.stdout.getReader();
      const first = await reader.read();
      reader.releaseLock();
      const port = Number(
        new TextDecoder().decode(first.value).match(/localhost:(\d+)/)?.[1]
      );
      expect(port).toBeGreaterThan(occupied.port);
      let body = '';
      const deadline = Date.now() + 4000;
      while (!body && Date.now() < deadline) {
        try {
          body = await (
            await fetch(`http://127.0.0.1:${port}`, {
              signal: AbortSignal.timeout(500),
            })
          ).text();
        } catch {
          await Bun.sleep(20);
        }
      }
      expect(body).toBe(`${port}:${port}`);
      child.kill('SIGINT');
      expect(await child.exited).toBe(0);
      expect(
        await (await fetch(`http://127.0.0.1:${occupied.port}`)).text()
      ).toBe('unrelated server');
    } finally {
      clearTimeout(limit);
      child.kill('SIGKILL');
      await occupied.server.stop(true);
    }
  },
  10000
);

test('dev launcher preserves unexpected failures instead of reporting success', () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      launcher,
      'fixture',
      '14500',
      process.execPath,
      '-e',
      'process.exit(7)',
    ],
    {
      env: { ...process.env, FIXTURE_PORT: '14500' },
      stdout: 'ignore',
      stderr: 'inherit',
    }
  );
  expect(child.exitCode).toBe(7);
});
