import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadServicesConfig,
  deployableServices,
  infraGithubRepo,
} from '../../packages/infra/lib/services';
const config = loadServicesConfig();
const ids = deployableServices(config)
  .filter((s) => s.github_repo === infraGithubRepo(config))
  .slice(0, 2)
  .map((s) => s.id);

for (const fail of [false, true])
  test(`serial image publishing ${fail ? 'stops on a failed build' : 'tags the exact revision without exposing its secret'}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'publish-'));
    const log = join(directory, 'commands');
    try {
      writeFileSync(
        join(directory, 'docker'),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PUBLISH_LOG"\nexit "$PUBLISH_EXIT"\n',
        { mode: 0o700 }
      );
      const result = Bun.spawnSync(
        [process.execPath, join(import.meta.dirname, 'publish.ts')],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            PUBLISH_LOG: log,
            PUBLISH_EXIT: fail ? '1' : '0',
            SERVICE_IDS: JSON.stringify(ids),
            GITHUB_SHA: 'fixture-revision',
            PORTFOLIO_GITHUB_TOKEN: 'fixture-private-token',
          },
        }
      );
      expect(result.exitCode === 0).toBe(!fail);
      const lines = readFileSync(log, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(fail ? 1 : ids.length);
      lines.forEach((line, index) => {
        expect(line).toContain(`${ids[index]}:fixture-revision`);
        expect(line).toContain(`${ids[index]}:latest`);
        expect(line).toContain(
          '--platform linux/amd64 --push --provenance=false'
        );
        expect(
          line.includes('id=github_token,env=PORTFOLIO_GITHUB_TOKEN')
        ).toBe(
          config.services
            .find((s) => s.id === ids[index])
            ?.secrets?.some((s) => s.name === 'PORTFOLIO_GITHUB_TOKEN') ?? false
        );
        expect(line).not.toContain('fixture-private-token');
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
