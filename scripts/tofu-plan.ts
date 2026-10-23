import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

type Diagnostic = {
  severity: string;
  summary: string;
  detail: string;
  address?: string;
};
type PlanResult = { code: number; errors: Diagnostic[]; valid: boolean };

// Retry only known temporary read failures. Authorization, configuration and
// mixed/unknown diagnostics need intervention, not another full state refresh.
function readRetrySeconds(error: Diagnostic, attempt: number): number | null {
  const backoff = 15 * 2 ** attempt;
  const text = `${error.summary} ${error.detail}`;
  if (
    /not authorized|unauthorized|forbidden|permission denied|authentication failed|invalid (?:token|credentials)/i.test(
      text
    )
  )
    return null;
  const request = /^GET\s+"https:\/\/[^\"]+":\s*(\d{3})\b/.exec(error.detail);
  const status = Number(request?.[1]);
  if (
    error.address?.startsWith('cloudflare_') &&
    error.summary === 'failed to make http request' &&
    (status === 429 || (status >= 500 && status <= 599))
  ) {
    const retryAfter = /"retry_after"\s*:\s*(\d+)/.exec(error.detail);
    return Math.max(backoff, Number(retryAfter?.[1] ?? 0));
  }
  if (
    /remaining connection slots|too many clients|\b53300\b|driver: bad connection/i.test(
      text
    )
  )
    return backoff;
  return null;
}

export function retryDelay(result: PlanResult, attempt: number): number | null {
  if (!result.valid || result.errors.length === 0) return null;
  const delays = result.errors.map((error) => readRetrySeconds(error, attempt));
  if (delays.some((delay) => delay === null)) return null;
  const seconds = Math.max(...(delays as number[]));
  return seconds <= 120 ? seconds * 1000 : null;
}

function reportFailure(
  root: string,
  result: PlanResult,
  attempts: number
): void {
  const message = `OpenTofu ${root} plan failed after ${attempts} attempt(s); no plan will be applied.`;
  const summaries = result.errors.map((error) => error.summary).join('; ');
  const escape = (text: string) =>
    text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.error(`::error title=OpenTofu plan failed::${escape(message)}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### OpenTofu plan failed\n\n${message}\n\n${summaries || 'See the plan log for diagnostics.'}\n`
    );
}

async function plan(root: string): Promise<PlanResult> {
  const child = Bun.spawn(
    [
      'tofu',
      `-chdir=${root}`,
      'plan',
      '-json',
      '-input=false',
      '-lock-timeout=30s',
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

const ATTEMPTS = 3;

export async function planWithRetry(
  root: string,
  run = plan,
  wait: (milliseconds: number) => Promise<unknown> = Bun.sleep
): Promise<number> {
  const savedPlan = join(root, 'apply.tfplan');
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    rmSync(savedPlan, { force: true });
    const result = await run(root);
    if (result.code === 0) return 0;
    rmSync(savedPlan, { force: true });
    const delay = retryDelay(result, attempt);
    if (attempt === ATTEMPTS - 1 || delay === null) {
      reportFailure(root, result, attempt + 1);
      return result.code;
    }
    console.log(
      `Plan failed; retrying plan ${attempt + 2}/${ATTEMPTS} in ${delay / 1000}s.`
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
