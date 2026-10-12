/**
 * The share card, rendered from site content on every build — the same
 * arrangement as the resume PDF, and for the same reason: there is no
 * committed image to forget to regenerate. Under `astro dev` it renders on
 * request; the cache only skips Chromium while content is unchanged.
 */
import { buildCardContent, cardVersion } from '../social/card';
import { renderCardPng } from '../social/render';

let cached: { readonly key: string; readonly bytes: Uint8Array } | null = null;

const cardBytes = async (): Promise<Uint8Array> => {
  const content = buildCardContent();
  const key = cardVersion(content);
  if (cached?.key !== key) {
    cached = { key, bytes: await renderCardPng(content) };
  }
  return cached.bytes;
};

export const GET = async (): Promise<Response> =>
  new Response(Buffer.from(await cardBytes()), {
    headers: { 'content-type': 'image/png' },
  });
