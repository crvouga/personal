import { checkbox, confirm, password, search, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { problemsFor } from '../../packages/infra/lib/health/secret-rules';
import type { Ui } from './types';
import { cancellation } from './cancel';

const context = { signal: cancellation.signal };

export const ui: Ui = {
  say: (message) => console.log(message),
  choose: (message, choices) => select({ message, choices }, context),
  scopes: () =>
    checkbox(
      {
        message: 'Which environments?',
        choices: [
          {
            name: 'Production  ·  personal/prd',
            value: 'prd' as const,
            checked: true,
          },
          {
            name: 'Development ·  personal/dev',
            value: 'dev' as const,
            checked: true,
          },
        ],
        required: true,
      },
      context
    ),
  key: (keys, inputs, configs) =>
    search(
      {
        message: 'Find a secret (type to filter)',
        source: (term) =>
          keys
            .filter((key) =>
              key.configs.some((c) => configs.includes(c as 'dev' | 'prd'))
            )
            .filter((key) =>
              `${key.name} ${key.used_by?.join(' ') ?? ''}`
                .toLowerCase()
                .includes((term ?? '').toLowerCase())
            )
            .map((key) => ({
              name: key.name,
              value: key.name,
              description: `${key.used_by?.join(', ') || 'Shared configuration'} · ${configs
                .filter((c) => key.configs.includes(c))
                .map(
                  (c) =>
                    `${c}: ${inputs.secrets[c][key.name] ? 'configured' : 'not set'}`
                )
                .join(' · ')}`,
            })),
      },
      context
    ),
  async value(name, scope, present) {
    const value = await password(
      {
        message: `${scope} · ${name}${present ? ' (Enter to keep)' : ''}`,
        mask: '*',
        validate: (value) => {
          if (!value && present) return true;
          if (!value.trim()) return 'Enter a value.';
          return (
            problemsFor(name, value).find((p) => p.severity === 'fail')
              ?.message ?? true
          );
        },
      },
      context
    );
    if (!value) return value;
    const warning = problemsFor(name, value).find((p) => p.severity === 'warn');
    if (
      warning &&
      !(await confirm(
        {
          message: `${name} ${warning.message}. Use this value?`,
          default: false,
        },
        context
      ))
    )
      return this.value(name, scope, present);
    return value;
  },
  confirm: (message, fallback = false) =>
    confirm({ message, default: fallback }, context),
  async task(message, action) {
    const spinner = ora(message).start();
    try {
      const result = await action();
      spinner.succeed(message);
      return result;
    } catch (error) {
      spinner.fail(message);
      throw error;
    }
  },
  review(inputs, fills) {
    console.log(chalk.bold('\n  Review changes'));
    for (const fill of fills) {
      const old = inputs.secrets[fill.config][fill.name];
      const status =
        old === fill.value ? 'keep / synchronize' : old ? 'replace' : 'add';
      console.log(
        `  ${chalk.cyan(fill.config.padEnd(5))} ${fill.name.padEnd(36)} ${chalk.yellow(status)}`
      );
    }
    console.log(
      chalk.dim(
        '\n  Existing values stay hidden. Unselected fields are preserved.\n'
      )
    );
  },
};
