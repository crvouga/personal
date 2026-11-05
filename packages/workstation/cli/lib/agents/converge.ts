import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, registry, type Selection } from './registry';
import { render } from './render';
import {
  atomicWrite,
  backup,
  fileState,
  readOwned,
  safeParents,
} from './files';

export type Receipt = {
  version: 1;
  revision: string;
  fingerprint: string;
  files: Record<string, string>;
};
export type Context = { root: string; revision: string; selection: Selection };

export async function plan(context: Context) {
  const { root, selection } = context;
  const directory = join(
    root,
    selection.node,
    selection.tool,
    selection.profile
  );
  const receiptPath = join(directory, 'receipt.json');
  const raw = await readOwned(receiptPath);
  const previous = raw ? (JSON.parse(raw) as Receipt) : null;
  const outputs = render(selection);
  const files = [];
  for (const [name, content] of Object.entries(outputs)) {
    const path = join(directory, name);
    const current = await readOwned(path);
    files.push({
      name,
      path,
      content,
      state: fileState(current, content, previous?.files[name]),
    });
  }
  const fingerprint = digest(JSON.stringify({ registry, selection, outputs }));
  return { directory, receiptPath, previous, files, fingerprint };
}

export async function convergeAgents(context: Context, adopt = false) {
  await safeParents(context.root);
  await mkdir(context.root, { recursive: true, mode: 0o700 });
  const lock = join(context.root, '.apply-lock');
  try {
    await mkdir(lock);
  } catch {
    throw new Error(
      'Another apply is active; inspect .apply-lock before retrying.'
    );
  }
  try {
    const result = await plan(context);
    if (!adopt && result.files.some((file) => file.state === 'conflict'))
      throw new Error(
        'Unmanaged or modified configuration. Review locally, then use --adopt to back up and replace only this profile.'
      );
    for (const file of result.files) {
      if (file.state === 'unchanged') continue;
      if ((await readOwned(file.path)) !== null)
        await backup(file.path, context.root);
      await atomicWrite(file.path, file.content);
    }
    const receipt: Receipt = {
      version: 1,
      revision: context.revision,
      fingerprint: result.fingerprint,
      files: Object.fromEntries(
        result.files.map((file) => [file.name, digest(file.content)])
      ),
    };
    const encoded = JSON.stringify(receipt, null, 2) + '\n';
    if ((await readOwned(result.receiptPath)) !== encoded)
      await atomicWrite(result.receiptPath, encoded);
    return publicPlan(result, context.revision);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export function publicPlan(
  result: Awaited<ReturnType<typeof plan>>,
  revision: string
) {
  return {
    revision,
    appliedRevision: result.previous?.revision ?? null,
    fingerprint: result.fingerprint,
    receiptMatches: result.previous?.fingerprint === result.fingerprint,
    files: result.files.map(({ name, state }) => ({ name, state })),
    t3EndToEnd: 'unverified',
    authenticatedInference: 'unverified',
  };
}
