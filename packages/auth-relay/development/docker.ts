import { command } from './process';

type Run = typeof command;

async function defaultColimaExists(
  env: NodeJS.ProcessEnv,
  run: Run
): Promise<boolean> {
  const profiles = await run(['colima', 'list', '--json'], env, true, {
    timeoutMs: 5000,
  });
  return profiles
    .trim()
    .split('\n')
    .some((line) => JSON.parse(line).name === 'default');
}

async function canStartColima(
  env: NodeJS.ProcessEnv,
  run: Run,
  installed: boolean
): Promise<boolean> {
  if (!installed || env['DOCKER_HOST'] || env['DOCKER_CONTEXT']) return false;
  const context = (
    await run(['docker', 'context', 'show'], env, true, { timeoutMs: 5000 })
  ).trim();
  // `colima stop` removes its context and selects Docker's standard default.
  // Start an existing default profile only, never implicitly create a VM.
  return (
    context === 'colima' ||
    (context === 'default' && (await defaultColimaExists(env, run)))
  );
}

/** Start an existing local runtime; never delete data or override explicit endpoints. */
export async function ensureDocker(
  env: NodeJS.ProcessEnv,
  run: Run = command,
  hasColima = Boolean(Bun.which('colima'))
): Promise<void> {
  process.stdout.write('Checking Docker availability (15 second timeout)...\n');
  try {
    await run(['docker', 'info', '--format', '{{.ServerVersion}}'], env, true, {
      timeoutMs: 15000,
    });
    return;
  } catch {
    if (await canStartColima(env, run, hasColima)) {
      process.stdout.write(
        'Starting the existing Colima runtime (up to 3 minutes)...\n'
      );
      await run(['colima', 'start'], env, false, { timeoutMs: 180000 });
      await run(
        ['docker', 'info', '--format', '{{.ServerVersion}}'],
        env,
        true,
        { timeoutMs: 15000 }
      );
      return;
    }
    throw new Error(
      'Docker is unavailable. Start your selected Docker runtime and run dev again. No runtime context was changed.'
    );
  }
}
