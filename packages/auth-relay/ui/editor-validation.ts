import { callbackAllowed } from '../src/policy';

export function callbackLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split('\n')
        .map((url) => url.trim())
        .filter(Boolean)
    ),
  ];
}

function identityLabel(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,79}$/.test(value)
    ? null
    : 'Start with a letter or number. Use up to 80 letters, numbers, spaces, dots, dashes, or underscores.';
}

export function registrationValidation(production: boolean) {
  return {
    name: identityLabel,
    project: identityLabel,
    instance: identityLabel,
    callbacks: (value: string) => {
      const urls = callbackLines(value);
      if (urls.length < 1 || urls.length > 8)
        return 'Enter 1–8 exact callback URLs, one per line.';
      return urls.every((url) => callbackAllowed(url, production))
        ? null
        : 'Use exact HTTPS URLs, or nonproduction HTTP localhost URLs with a port. No wildcards, query strings, or fragments.';
    },
    expiresAt: (value: string) => {
      const lifetime = new Date(value).getTime() - Date.now();
      return lifetime > 0 && lifetime <= (production ? 366 : 7) * 86400_000
        ? null
        : `Choose a future expiry within ${production ? '366 days' : '7 days'}.`;
    },
    ownership: (value: boolean) =>
      value ? null : 'Confirm you verified ownership before saving.',
  };
}
