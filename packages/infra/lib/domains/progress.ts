import { AsyncLocalStorage } from 'node:async_hooks';

export type MigrationProgress = {
  readonly type: 'progress' | 'heartbeat';
  readonly at: string;
  readonly elapsedSeconds: number;
  readonly phase: string;
  readonly message: string;
  readonly domain?: string;
};
type Stage = Pick<MigrationProgress, 'phase' | 'message' | 'domain'>;
type Observer = { readonly emit: (stage: Stage) => void };
const observers = new AsyncLocalStorage<Observer>();

/** Only explicit public stage descriptions; never command arguments or provider output. */
export function migrationProgress(phase: string, message: string, domain?: string): void {
  observers.getStore()?.emit({ phase, message, ...(domain ? { domain } : {}) });
}

/** Scope progress to this execution, and clean up its heartbeat on every exit. */
export async function withMigrationProgress<T>(notify: (event: MigrationProgress) => void, task: () => Promise<T>, heartbeatMs = 15000): Promise<T> {
  const started = Date.now();
  let last: Stage = { phase: 'startup', message: 'Starting domain migration' };
  const send = (type: MigrationProgress['type'], stage: Stage) => notify({
    type, at: new Date().toISOString(), elapsedSeconds: Math.floor((Date.now() - started) / 1000), ...stage,
  });
  const observer: Observer = { emit: (stage) => { last = stage; send('progress', stage); } };
  send('progress', last);
  const timer = setInterval(() => send('heartbeat', last), heartbeatMs);
  timer.unref();
  try { return await observers.run(observer, task); }
  finally { clearInterval(timer); }
}

export function progressLine(event: MigrationProgress): string {
  const domain = event.domain ? `${event.domain}: ` : '';
  const prefix = event.type === 'heartbeat' ? 'Still running; last stage: ' : '';
  return `[+${event.elapsedSeconds}s] ${prefix}${domain}${event.message}`;
}
