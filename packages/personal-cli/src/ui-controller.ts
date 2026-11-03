import type { InteractiveOptions } from './contracts';
import { runCommand } from './ui-actions';
import { clean, commandChoices, isCancellation } from './ui-data';
import { addNode } from './ui-wizard';
import type { Choice, Display, Prompts, Session } from './ui-types';

export async function runInteractive(
  options: InteractiveOptions,
  prompts: Prompts,
  display: Display
): Promise<void> {
  const session: Session = { options, prompts, display };
  showHeader(session);
  let running = true;
  while (running) {
    try {
      const choice = await prompts.search(
        'Command palette · type to search · arrows + enter',
        (term) => paletteChoices(session, term)
      );
      running = await dispatch(session, choice);
    } catch (error) {
      if (isCancellation(error)) {
        display.write('\nGoodbye. No further actions will run.');
        throw error;
      }
      display.write(
        'The interactive session could not continue safely. Use personal commands --json for noninteractive help.'
      );
      throw new Error('Interactive session failed safely.');
    }
  }
  display.write('Goodbye. Session context was not saved.');
}

function showHeader(session: Session): void {
  session.display.panel(
    `personal · ${clean(session.options.version)} · operator console`,
    [
      'Your developer fleet, without the guesswork.',
      `Workspace: ${clean(session.workspace ?? session.options.workspace)}`,
      `Config: ${clean(session.config ?? session.options.config)}`,
      'Read-only first · explicit writes · no automatic repairs',
      'Search IDs, keywords or descriptions. Ctrl+C exits safely. Nothing is cleared.',
    ].join('\n')
  );
}

export function paletteChoices(session: Session, term: string): Choice[] {
  const commands = commandChoices(session.options.commands, term);
  const navigation = [
    {
      name: 'Fleet setup / add node…',
      value: 'setup',
      description:
        'Register an existing node; preview + explicit approval before saving.',
    },
    {
      name: 'Session workspace / config…',
      value: 'context',
      description: 'Session-only overrides; no hidden configuration writes.',
    },
  ].filter((choice) =>
    `${choice.name} ${choice.description}`
      .toLowerCase()
      .includes(term.toLowerCase().trim())
  );
  const groups = term.trim()
    ? []
    : [
        ...new Set(session.options.commands.map((command) => command.group)),
      ].map((group) => ({
        name: `Browse ${clean(group)}…`,
        value: `group:${group}`,
      }));
  return [
    ...groups,
    ...navigation,
    ...commands,
    ...(!commands.length && !navigation.length && term.trim()
      ? [
          {
            name: 'No matching commands — change search or go back',
            value: 'none',
          },
        ]
      : []),
    { name: 'Exit', value: 'exit' },
  ];
}

async function dispatch(session: Session, choice: string): Promise<boolean> {
  if (choice === 'exit') return false;
  if (choice === 'setup') await addNode(session);
  if (choice === 'context') await changeContext(session);
  if (choice.startsWith('group:')) await browseGroup(session, choice.slice(6));
  if (choice.startsWith('command:'))
    await openCommand(session, choice.slice(8));
  return true;
}

async function browseGroup(session: Session, group: string): Promise<void> {
  const commands = session.options.commands.filter(
    (command) => command.group === group
  );
  while (true) {
    const choice = await session.prompts.search(
      `${clean(group)} · searchable submenu`,
      (term) => {
        const choices = commandChoices(commands, term);
        return [
          ...(choices.length
            ? choices
            : [{ name: 'No matches — try another keyword', value: 'none' }]),
          { name: 'Back to all commands', value: 'back' },
        ];
      }
    );
    if (choice === 'back') return;
    if (choice.startsWith('command:'))
      await openCommand(session, choice.slice(8));
  }
}

async function openCommand(session: Session, id: string): Promise<void> {
  const command = session.options.commands.find((entry) => entry.id === id);
  if (!command) return;
  if (command.args[0] === 'fleet' && command.args[1] === 'add')
    await addNode(session);
  else await runCommand(session, command);
}

async function changeContext(session: Session): Promise<void> {
  session.display.write(
    'Session only. Blank inputs reset to startup defaults; no file is written.'
  );
  const workspace = await session.prompts.input(
    'Workspace override',
    session.workspace ?? '',
    validContext
  );
  const config = await session.prompts.input(
    'Config override',
    session.config ?? '',
    validContext
  );
  if (workspace) session.workspace = workspace;
  else delete session.workspace;
  if (config) session.config = config;
  else delete session.config;
  showHeader(session);
}

function validContext(value: string): boolean | string {
  return (
    !/[\x00-\x1f\x7f]/.test(value) ||
    'Control characters are not allowed in paths.'
  );
}
