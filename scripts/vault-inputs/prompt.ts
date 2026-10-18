// Minimal terminal prompts (no dependency): visible input, hidden input and
// yes/no. Hidden input uses raw mode so pasted secrets are never echoed.
import { createInterface } from 'node:readline/promises';

export async function ask(question: string, fallback = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback ? ` [${fallback}]` : '';
    return (await rl.question(`${question}${suffix}: `)).trim() || fallback;
  } finally {
    rl.close();
  }
}

export async function confirm(
  question: string,
  fallback = true
): Promise<boolean> {
  const answer = (
    await ask(`${question} (${fallback ? 'Y/n' : 'y/N'})`)
  ).toLowerCase();
  return answer === '' ? fallback : answer.startsWith('y');
}

export function askSecret(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(`${question} (input hidden): `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') return finish(new Error('Cancelled'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}
