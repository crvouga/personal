import { randomInt, randomUUID } from 'node:crypto';
import type { Runtime } from '../domain/ports.ts';
const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*_-+=';
export const runtime: Runtime = {
  now: () => new Date().toISOString(),
  id: randomUUID,
  password: generatePassword,
};

function generatePassword(): string {
  for (;;) {
    const value = Array.from(
      { length: 32 },
      () => alphabet[randomInt(alphabet.length)]
    ).join('');
    if (
      /[A-Z]/.test(value) &&
      /[a-z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^a-zA-Z0-9]/.test(value)
    )
      return value;
  }
}
