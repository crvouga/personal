import { rmSync } from 'node:fs';
import { join } from 'node:path';

type Diagnostic = {
  severity: string;
  summary: string;
  detail: string;
  address?: string;
};
type PlanResult = { code: number; errors: Diagnostic[]; valid: boolean };

// The shared PostgreSQL cluster has few connection slots and the running
// services hold most of them, so an Atlas inspection can be refused (53300)
// until a pool drains. That read is idempotent, like a Cloudflare GET.
const SLOTS_EXHAUSTED =
  /\(53300\)|too many clients already|remaining connection slots are reserved/;

function readRetrySeconds(error: Diagnostic, attempt: number): number | null {
  if (SLOTS_EXHAUSTED.test(`${error.summary}\n${error.detail}`))
    return 60 * 2 ** attempt;
  const request = /^GET\s+"https:\/\/[^\"]+":\s*(\d{3})\b/.exec(error.detail);
  const status = Number(request?.[1]);
  if (
    !error.address?.startsWith('cloudflare_') ||
    error.summary !== 'failed to make http request' ||
    !(status === 429 || (status >= 500 && status <= 599))
  )
    return null;
  const retryAfter = /"retry_after"\s*:\s*(\d+)/.exec(error.detail);
  return Math.max(120 * 2 ** attempt, Number(retryAfter?.[1] ?? 0));
}

// Retry only failed reads. Replaying a partially completed apply can repeat
// mutations, and a transient error must never hide another, permanent error.
export function retryDelay(result: PlanResult, attempt: number): number | null {
  if (!result.valid || result.errors.length === 0) return null;
  let seconds = 0;
  for (const error of result.errors) {
    const wait = readRetrySeconds(error, attempt);
    if (wait === null) return null;
    seconds = Math.max(seconds, wait);
  }
  // Do not turn an upstream outage into an unbounded deployment wait.
  return seconds <= 600 ? seconds * 1000 : null;
}

async function plan(root: string): Promise<PlanResult> {
  const child = Bun.spawn(
    [
      'tofu',
      `-chdir=${root}`,
      'plan',
      '-json',
      '-input=false',
      '-lock-timeout=15m',
      '-parallelism=1',
      '-out=apply.tfplan',
    ],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' }
  );
  const errors: Diagnostic[] = [];
  let valid = true;
  const display = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.type === 'diagnostic') {
        const diagnostic: Diagnostic = event.diagnostic;
        if (
          !diagnostic ||
          typeof diagnostic.severity !== 'string' ||
          typeof diagnostic.summary !== 'string' ||
          typeof diagnostic.detail !== 'string'
        )
          throw new Error('Malformed OpenTofu diagnostic');
        console.log(`${diagnostic.severity}: ${diagnostic.summary}`);
        console.log(diagnostic.detail);
        if (diagnostic.severity === 'error') errors.push(diagnostic);
      } else if (typeof event['@message'] === 'string') {
        console.log(event['@message']);
      }
    } catch {
      valid = false;
      console.log(line);
    }
  };
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of child.stdout) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) display(line);
  }
  display(pending + decoder.decode());
  return { code: await child.exited, errors, valid };
}

export async function planWithRetry(
  root: string,
  run = plan,
  wait: (milliseconds: number) => Promise<unknown> = Bun.sleep
): Promise<number> {
  const savedPlan = join(root, 'apply.tfplan');
  for (let attempt = 0; attempt < 3; attempt++) {
    rmSync(savedPlan, { force: true });
    const result = await run(root);
    if (result.code === 0) return 0;
    rmSync(savedPlan, { force: true });
    const delay = retryDelay(result, attempt);
    if (attempt === 2 || delay === null) return result.code;
    console.log(
      `Read failed transiently; retrying plan ${attempt + 2}/3 in ${delay / 1000}s.`
    );
    await wait(delay);
  }
  return 1;
}

if (import.meta.main) {
  const root = process.env.TOFU_ROOT ?? '';
  if (
    ![
      'foundation',
      'bootstrap',
      'vault',
      'fleet',
      'auth-hosting',
      'auth',
    ].includes(root)
  ) {
    throw new Error('TOFU_ROOT must name a supported OpenTofu root');
  }
  process.exitCode = await planWithRetry(`packages/infra/tofu/${root}`);
}
