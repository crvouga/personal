// Terminal side effects for `auth:setup`, behind one interface so the flow can be
// tested without a browser, clipboard or network.
import { capture } from '../vault-inputs/process';
import { ask, confirm } from '../vault-inputs/prompt';

export interface Io {
  say(line?: string): void;
  ask(question: string, fallback?: string): Promise<string>;
  confirm(question: string, fallback?: boolean): Promise<boolean>;
  /** True when the text reached the clipboard; secrets are never printed. */
  copy(text: string): Promise<boolean>;
  open(url: string): Promise<void>;
  get(url: string): Promise<{ status: number; body: string } | undefined>;
  gitEmail(): Promise<string>;
  sleep(ms: number): Promise<unknown>;
  now(): Date;
}

async function copy(text: string): Promise<boolean> {
  const tools = [['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard']];
  for (const cmd of tools) {
    try {
      const child = Bun.spawn({
        cmd,
        stdin: 'pipe',
        stdout: 'ignore',
        stderr: 'ignore',
      });
      child.stdin.write(text);
      await child.stdin.end();
      if ((await child.exited) === 0) return true;
    } catch {
      // Try the next clipboard tool.
    }
  }
  return false;
}

export const terminal: Io = {
  say: (line = '') => console.log(line),
  ask,
  confirm,
  copy,
  async open(url) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    await capture([opener, url]);
  },
  async get(url) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, body: await response.text() };
    } catch {
      return undefined;
    }
  },
  gitEmail: async () => (await capture(['git', 'config', 'user.email'])) ?? '',
  sleep: (ms) => Bun.sleep(ms),
  now: () => new Date(),
};
