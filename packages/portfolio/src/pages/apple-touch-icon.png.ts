/**
 * The icon iOS uses for share sheets, bookmarks and the home screen. Without
 * one it falls back to a blurred screenshot of the page.
 */
import { CONTENT } from '../content/content';
import { renderTouchIconPng } from '../social/render';

let cached: { readonly key: string; readonly bytes: Uint8Array } | null = null;

const iconBytes = async (): Promise<Uint8Array> => {
  const key = CONTENT.MONOGRAM_INITIALS;
  if (cached?.key !== key) {
    cached = { key, bytes: await renderTouchIconPng(key) };
  }
  return cached.bytes;
};

export const GET = async (): Promise<Response> =>
  new Response(Buffer.from(await iconBytes()), {
    headers: { 'content-type': 'image/png' },
  });
