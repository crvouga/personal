/**
 * For `/index/`: cover art for each item. Deterministic: its key seeds
 * every choice, so an item keeps its art across builds, and the category picks
 * the palette. Served as files by `src/pages/index/art/[slug].svg.ts`.
 */

import type { Category } from '../content/service-index';

export const ART_WIDTH = 640;
export const ART_HEIGHT = 400;

/** Base hue per category; each host drifts a little from it. */
const CATEGORY_HUE: Readonly<Record<Category, number>> = {
  'public-app': 222,
  'public-api': 160,
  'internal-dashboard': 32,
  'internal-api': 268,
  postgres: 196,
  blob: 330,
  domain: 52,
};

/** FNV-1a: a small, stable string hash. */
export const hash = (text: string): number => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
};

/** mulberry32, seeded: the same host always draws the same picture. */
const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const round = (value: number): string => String(Math.round(value * 10) / 10);

const hsl = (
  hue: number,
  saturation: number,
  lightness: number,
  alpha = 1
): string =>
  `hsl(${round(((hue % 360) + 360) % 360)} ${round(saturation)}% ${round(lightness)}% / ${round(alpha)})`;

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

/** Up to two letters: initials of the first two words, else the first two letters. */
export const monogram = (title: string): string => {
  const words = title
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .split(/[\s.-]+/)
    .filter((word) => word !== '');
  const first = words[0] ?? '?';
  const letters =
    words.length > 1 && /\p{L}/u.test(words[1]?.[0] ?? '')
      ? `${first[0] ?? ''}${words[1]?.[0] ?? ''}`
      : first.slice(0, 2);
  return letters.toUpperCase();
};

type Draw = (next: () => number, hue: number) => string;

const blobs: Draw = (next, hue) =>
  Array.from({ length: 4 }, (_, index) => {
    const x = next() * ART_WIDTH;
    const y = next() * ART_HEIGHT;
    const radius = 90 + next() * 170;
    return `<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius)}" fill="${hsl(hue + (index - 1.5) * 28, 85, 62, 0.55)}"/>`;
  }).join('');

const rings: Draw = (next, hue) => {
  const x = ART_WIDTH * (0.55 + next() * 0.35);
  const y = ART_HEIGHT * (0.2 + next() * 0.6);
  return Array.from(
    { length: 9 },
    (_, index) =>
      `<circle cx="${round(x)}" cy="${round(y)}" r="${String(36 + index * 34)}" fill="none" stroke="${hsl(hue + index * 6, 90, 80, 0.32 - index * 0.025)}" stroke-width="${String(10 - index * 0.8)}"/>`
  ).join('');
};

const waves: Draw = (next, hue) =>
  Array.from({ length: 6 }, (_, index) => {
    const base = 120 + index * 46;
    const amplitude = 18 + next() * 36;
    const phase = next() * ART_WIDTH;
    const points = Array.from({ length: 17 }, (_, step) => {
      const x = (step / 16) * ART_WIDTH;
      const y = base + Math.sin((x + phase) / 70) * amplitude;
      return `${round(x)},${round(y)}`;
    }).join(' L');
    return `<path d="M${points}" fill="none" stroke="${hsl(hue + index * 10, 90, 82, 0.4)}" stroke-width="3" stroke-linecap="round"/>`;
  }).join('');

const grid: Draw = (next, hue) => {
  const step = 40;
  const cells: string[] = [];
  for (let y = step / 2; y < ART_HEIGHT; y += step) {
    for (let x = step / 2; x < ART_WIDTH; x += step) {
      const size = next() ** 3 * 11;
      if (size < 2.5) continue;
      cells.push(
        `<rect x="${round(x - size / 2)}" y="${round(y - size / 2)}" width="${round(size)}" height="${round(size)}" rx="2" fill="${hsl(hue + next() * 40, 90, 86, 0.55)}"/>`
      );
    }
  }
  return cells.join('');
};

const DRAWS: readonly Draw[] = [rings, waves, grid];

/** A complete SVG document for one host. */
export const artSvg = (
  hostname: string,
  title: string,
  category: Category
): string => {
  const seed = hash(hostname);
  const next = random(seed);
  const hue = CATEGORY_HUE[category] + (next() - 0.5) * 40;
  const angle = Math.round(next() * 360);
  const pattern = DRAWS[seed % DRAWS.length] ?? rings;
  const letters = escapeXml(monogram(title));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(ART_WIDTH)} ${String(ART_HEIGHT)}" width="${String(ART_WIDTH)}" height="${String(ART_HEIGHT)}" role="img" aria-label="${escapeXml(title)}">`,
    '<defs>',
    `<linearGradient id="bg" gradientTransform="rotate(${String(angle)} .5 .5)">`,
    `<stop offset="0" stop-color="${hsl(hue, 70, 22)}"/>`,
    `<stop offset="1" stop-color="${hsl(hue + 48, 75, 38)}"/>`,
    '</linearGradient>',
    '<filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="46"/></filter>',
    '<radialGradient id="shine" cx=".2" cy=".1" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
    '</defs>',
    `<rect width="100%" height="100%" fill="url(#bg)"/>`,
    `<g filter="url(#blur)">${blobs(next, hue)}</g>`,
    `<g>${pattern(next, hue)}</g>`,
    `<rect width="100%" height="100%" fill="url(#shine)"/>`,
    `<text x="40" y="${String(ART_HEIGHT - 44)}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="120" font-weight="800" letter-spacing="-4" fill="#fff" fill-opacity=".92">${letters}</text>`,
    '</svg>',
  ].join('');
};
