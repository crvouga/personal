import { describe, test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { select, digest, resolveModel } from './registry';
import { render, agentRoot } from './render';
import { convergeAgents, plan, publicPlan } from './converge';
import { safeParents } from './files';

const revision = 'a'.repeat(40);

describe('agent configuration ownership', () => {
  test('separates routes and platform destinations without secret values', () => {
    const proxy = render(select('canary', 'codex', 'proxy'))['config.toml']!;
    expect(proxy).toContain('wire_api = "responses"');
    expect(proxy).toContain('env_key = "CLIPROXY_API_KEY"');
    expect(
      render(select('canary', 'codex', 'direct'))['config.toml']
    ).not.toContain('personal_proxy');
    expect(agentRoot('C:\\Users\\dev', 'windows')).toBe(
      'C:\\Users\\dev\\AppData\\Local\\personal\\agents'
    );
    expect(agentRoot('/home/dev', 'linux')).toBe(
      '/home/dev/.config/personal/agents'
    );
    expect(
      resolveModel('canary', 'codex', 'direct', {
        canary: { codex: { direct: 'reviewed-model' } },
      })
    ).toBe('reviewed-model');
    expect(() => select('../escape', 'codex', 'direct')).toThrow();
    expect(() => select('node', 'gemini', 'proxy')).toThrow();
    expect(() => select('node', 'claude', 'proxy')).toThrow();
  });

  test('preview is read-only; apply is idempotent and detects modifications', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-agents-'));
    try {
      const context = {
        root,
        revision,
        selection: select('canary', 'codex', 'proxy'),
      };
      expect((await plan(context)).files[0]?.state).toBe('create');
      await convergeAgents(context);
      const initial = await plan(context);
      const receipt = await readFile(initial.receiptPath, 'utf8');
      await convergeAgents(context);
      expect(await readFile(initial.receiptPath, 'utf8')).toBe(receipt);
      expect((await plan(context)).files[0]?.state).toBe('unchanged');
      await writeFile(initial.files[0]!.path, 'PRIVATE_SENTINEL');
      await expect(convergeAgents(context)).rejects.toThrow('Unmanaged');
      expect(
        JSON.stringify(publicPlan(await plan(context), revision))
      ).not.toContain('PRIVATE_SENTINEL');
      await convergeAgents(context, true);
      expect((await plan(context)).files[0]?.state).toBe('unchanged');
      expect(JSON.parse(receipt).files['config.toml']).toBe(
        digest(initial.files[0]!.content)
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects symlink destinations and concurrent application', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-conflict-'));
    try {
      await symlink(root, join(root, 'alias'));
      await expect(safeParents(join(root, 'alias', 'config'))).rejects.toThrow(
        'Symlink conflict'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
