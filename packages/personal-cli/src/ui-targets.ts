import { execute, showOutcome, successful } from './ui-execute';
import { record, text } from './ui-data';
import type { Choice, Session } from './ui-types';

export async function chooseTargets(
  session: Session,
  action: string
): Promise<string[] | undefined> {
  const selection = await session.prompts.select('Choose target scope', [
    ...(action === 'onboard'
      ? []
      : [
          {
            name: 'Controller only / local',
            value: 'local',
            description:
              'No roster or SSH required; uses this session workspace.',
          },
          {
            name: 'All roster nodes',
            value: 'all',
            description:
              action === 'doctor'
                ? 'Controller + every configured node; read-only.'
                : 'Every configured remote checkout.',
          },
        ]),
    { name: 'Select roster nodes…', value: 'selected' },
    { name: 'Back to palette', value: 'back' },
  ]);
  if (selection === 'back') return undefined;
  if (selection === 'local') return ['--local'];
  const nodes = await availableNodes(session);
  if (!nodes.length) return missingRoster(session, action);
  if (selection === 'all') return [];
  const selected = await session.prompts.checkbox(
    'Select nodes · space to toggle, enter to continue',
    nodes
  );
  if (!selected.length) {
    session.display.write(
      'No nodes selected. Nothing ran; returning to the palette.'
    );
    return undefined;
  }
  return selected.flatMap((id) => ['--node', id]);
}

async function availableNodes(session: Session): Promise<Choice[]> {
  const outcome = await execute(
    session,
    ['fleet', 'nodes'],
    'Reading local roster (no SSH)'
  );
  if (!successful(outcome)) {
    showOutcome(session, outcome);
    return [];
  }
  if (!record(outcome.data) || !Array.isArray(outcome.data['nodes'])) return [];
  return outcome.data['nodes'].flatMap((node: unknown) => {
    if (!record(node) || typeof node['id'] !== 'string') return [];
    return [
      {
        name: text(node['id']),
        value: node['id'],
        description: `${text(node['ssh'])} · ${text(node['workspace'])}`,
      },
    ];
  });
}

async function missingRoster(
  session: Session,
  action: string
): Promise<string[] | undefined> {
  session.display.panel(
    'Fleet setup needed',
    [
      'No usable roster nodes. Return to Fleet setup / add node to register an existing computer.',
      'Fleet init creates an EXAMPLE only; saving it requires --apply --yes. Edit its aliases and paths before use.',
      'Controller-only doctor works without a roster or SSH. No login, host-key change or repair is automatic.',
    ].join('\n')
  );
  if (action !== 'doctor') return undefined;
  const choice = await session.prompts.select('Continue without a roster?', [
    { name: 'Run controller-only diagnostics', value: 'local' },
    { name: 'Back to palette / Fleet setup', value: 'back' },
  ]);
  return choice === 'local' ? ['--local'] : undefined;
}
