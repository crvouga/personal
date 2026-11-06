import { dirname } from 'node:path';
import { record } from '../../fleet/src/config';
import { mustRun } from './release-io';
import { interactiveNpm } from './release-publisher';
import { npmCommand } from './npm';
import { PACKAGE } from './release-model';
import { ReleaseError } from './release-error';
import {
  terminalOutput,
  terminalPublisherConfigurations,
} from './release-terminal';

export function trustConfigurations(text: string): unknown[] {
  const objects: unknown[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor]!)) {
      cursor += 1;
      continue;
    }
    if (text[cursor] !== '{')
      throw new ReleaseError(
        'Unexpected npm trusted-publisher response; no configuration changed.'
      );
    const end = jsonObjectEnd(text, cursor);
    objects.push(JSON.parse(text.slice(cursor, end + 1)) as unknown);
    cursor = end + 1;
  }
  return objects;
}

function jsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (!depth) return index;
    }
  }
  throw new ReleaseError(
    'Incomplete npm trusted-publisher response; no configuration changed.'
  );
}

export function hasCiPublisher(configurations: unknown[]): boolean {
  return configurations.some(
    (config) =>
      record(config) &&
      config['type'] === 'github' &&
      config['repository'] === 'crvouga/personal' &&
      config['file'] === 'ci.yml' &&
      !config['environment'] &&
      Array.isArray(config['permissions']) &&
      config['permissions'].includes('createPackage')
  );
}

export async function configurePublisher(
  env: NodeJS.ProcessEnv
): Promise<void> {
  const existing = await readPublisher(env);
  if (hasCiPublisher(existing)) {
    process.stdout.write(
      'The exact CI trusted publisher is already configured.\n'
    );
    return;
  }
  await interactiveNpm(
    [
      'trust',
      'github',
      PACKAGE,
      '--repository',
      'crvouga/personal',
      '--file',
      'ci.yml',
      '--allow-publish',
      '--yes',
    ],
    env
  );
  const saved = await readPublisher(env);
  if (!hasCiPublisher(saved))
    throw new ReleaseError(
      'Package exists, but CI publisher verification is unconfirmed. Rerun bootstrap; it will not republish unchanged content.'
    );
  process.stdout.write(
    'Verified CI trusted publisher: crvouga/personal / ci.yml.\n'
  );
}

async function readPublisher(env: NodeJS.ProcessEnv): Promise<unknown[]> {
  const cwd = dirname(env['NPM_CONFIG_USERCONFIG']!);
  const interactive =
    process.stdin.isTTY && process.stdout.isTTY && !process.env['CI'];
  if (interactive) {
    const output = await terminalOutput(
      await npmCommand(['trust', 'list', PACKAGE]),
      cwd,
      { ...env, NPM_CONFIG_COLOR: 'false' }
    );
    return terminalPublisherConfigurations(output);
  }
  return trustConfigurations(
    await mustRun(
      await npmCommand(['trust', 'list', PACKAGE, '--json']),
      cwd,
      env,
      { stage: 'publisher-verification' }
    )
  );
}
