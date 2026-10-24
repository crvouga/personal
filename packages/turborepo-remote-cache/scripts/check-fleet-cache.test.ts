import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const paths = ['ci', 'web', 'cache', 'netboot', 'devbox'].map(
  (role) => `/nix/store/${'a'.repeat(32)}-${role}`
);
const metadata = {
  cacheUrl: 'https://cache.invalid/nix',
  cachePublicKey: 'fixture:key',
};

function probe(mode: string) {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-cache-probe-'));
  const file = (name: string) => join(directory, name);
  const read = (name: string) =>
    existsSync(file(name)) ? readFileSync(file(name), 'utf8') : '';
  try {
    writeFileSync(
      file('nix'),
      `#!/bin/sh
printf '%s\\n' "$1" >> "$FAKE_DIRECTORY/commands"
if [ "$1" = eval ]; then
  if [ "$FAKE_MODE" = error ]; then exit 2; fi
  printf '%s' "$FAKE_EVALUATION"
else
  printf '%s\\n' "$@" > "$FAKE_DIRECTORY/verify"
  test "$FAKE_MODE" = hit
fi
`,
      { mode: 0o755 }
    );
    writeFileSync(
      file('timeout'),
      '#!/bin/sh\nprintf "%s" "$1" > "$FAKE_DIRECTORY/timeout-value"\nshift\nexec "$@"\n',
      { mode: 0o755 }
    );
    writeFileSync(file('git'), `#!/bin/sh\nprintf '%s' '${'a'.repeat(40)}'\n`, {
      mode: 0o755,
    });
    const result = Bun.spawnSync(
      [process.execPath, join(import.meta.dirname, 'check-fleet-cache.ts')],
      {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env['PATH']}`,
          FAKE_DIRECTORY: directory,
          FAKE_MODE: mode,
          FAKE_EVALUATION: JSON.stringify({ metadata, paths }),
          FLEET_CACHE_PROOF: file('proof'),
          GITHUB_OUTPUT: file('output'),
        },
      }
    );
    return {
      code: result.exitCode,
      output: read('output'),
      proof: read('proof'),
      commands: read('commands'),
      verify: read('verify').trim().split('\n'),
      timeout: read('timeout-value'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('one evaluation retains every exact path and pinned signature check before accepting a warm cache', () => {
  const result = probe('hit');
  expect(result.code).toBe(0);
  expect(result.commands).toBe('eval\nstore\n');
  expect(result.timeout).toBe('45');
  expect(result.verify).toEqual([
    'store',
    'verify',
    '--store',
    metadata.cacheUrl,
    '--no-contents',
    '--sigs-needed',
    '1',
    '--option',
    'trusted-public-keys',
    metadata.cachePublicKey,
    '--option',
    'narinfo-cache-negative-ttl',
    '0',
    ...paths,
  ]);
  expect(result.output).toBe('hit=true\n');
  expect(JSON.parse(result.proof)).toEqual({
    version: 1,
    revision: 'a'.repeat(40),
    publicKey: metadata.cachePublicKey,
    paths,
    signedPaths: 5,
  });
});

test('an unavailable or invalid signature is a cache miss without a publication proof', () => {
  const result = probe('miss');
  expect(result.code).toBe(0);
  expect(result.output).toBe('hit=false\n');
  expect(result.proof).toBe('');
});

test('evaluation failure cannot accept or silently skip publication', () => {
  const result = probe('error');
  expect(result.code).not.toBe(0);
  expect(result.commands).toBe('eval\n');
  expect(result.output).toBe('');
  expect(result.proof).toBe('');
});
