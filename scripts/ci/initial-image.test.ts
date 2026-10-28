import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const action = parse(
  readFileSync(
    join(import.meta.dirname, '../../.github/actions/tofu/action.yml'),
    'utf8'
  )
);
const step = action.runs.steps.find(
  (candidate: { name?: string }) =>
    candidate.name === 'Preserve deployed image revisions'
);

function preserve(selected: string[] = [], tag = ''): unknown {
  const directory = mkdtempSync(join(tmpdir(), 'initial-image-'));
  const inventory = join(directory, 'packages/infra/tofu/modules/inventory');
  mkdirSync(inventory, { recursive: true });
  writeFileSync(
    join(inventory, 'inventory.tf.json'),
    JSON.stringify({
      locals: {
        inventory: {
          default_image_tag: 'latest',
          services: [
            { id: 'existing', initial_image_tag: 'outdated-initial' },
            { id: 'new-app', initial_image_tag: 'reviewed-commit' },
            { id: 'legacy-default' },
            { id: 'standalone', standalone: true },
            { id: 'tunnel', kind: 'tunnel' },
          ],
        },
      },
    })
  );
  writeFileSync(
    join(directory, 'tofu'),
    '#!/bin/sh\nprintf \'%s\\n\' \'{"existing":"live-commit"}\'\n',
    { mode: 0o700 }
  );
  const output = join(directory, 'output');
  try {
    const script = step.run
      .replaceAll('/tmp/tofu-image-tags.json', join(directory, 'tags.json'))
      .replaceAll('/tmp/tofu-next-tags.json', join(directory, 'next.json'));
    const result = Bun.spawnSync(['bash', '-c', script], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        TOFU_ROOT: 'services',
        SERVICE_IDS: JSON.stringify(selected),
        IMAGE_TAG: tag,
        GITHUB_ENV: output,
      },
    });
    expect(result.exitCode).toBe(0);
    return JSON.parse(
      readFileSync(output, 'utf8').trim().replace('TF_VAR_image_tags=', '')
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('first activation uses the reviewed image while preserving existing releases', () => {
  expect(preserve()).toEqual({
    existing: 'live-commit',
    'new-app': 'reviewed-commit',
    'legacy-default': 'latest',
  });
});

test('later publisher dispatch replaces only the selected release', () => {
  expect(preserve(['new-app'], 'next-commit')).toEqual({
    existing: 'live-commit',
    'new-app': 'next-commit',
    'legacy-default': 'latest',
  });
});
