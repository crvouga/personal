const OWNER_ORIGINS = new Set(['https://account.squarespace.com', 'https://domains.squarespace.com', 'https://login.squarespace.com']);

export function ownerPageAllowed(url: string): boolean {
  try { const parsed = new URL(url); return !parsed.username && !parsed.password && OWNER_ORIGINS.has(parsed.origin); }
  catch { return false; }
}

/** Fail closed on writes, foreign navigation, and untrusted subresources. */
export function ownerReadRequest(url: string, method: string, navigation: boolean): boolean {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (navigation) return ownerPageAllowed(url);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    return ['squarespace.com', 'squarespace-cdn.com', 'sqspcdn.com', 'fonts.googleapis.com', 'fonts.gstatic.com']
      .some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
