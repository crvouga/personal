import { expect, test } from 'bun:test';
import { registryDocument } from '../scripts/release-model';

test('registry plans and verification use fresh full-metadata reads rather than a cached pre-publish URL', async () => {
  const urls: string[] = [];
  const request = (async (input: URL, options: RequestInit) => {
    urls.push(input.href);
    expect(input.origin).toBe('https://registry.npmjs.org');
    expect(decodeURIComponent(input.pathname)).toBe('/@crvouga/personal');
    expect(input.searchParams.get('personal-release')).toBeTruthy();
    expect(options.headers).toEqual({
      'Cache-Control': 'no-cache',
      Accept: 'application/json',
    });
    return Response.json({ 'dist-tags': {}, versions: {} });
  }) as typeof fetch;
  await registryDocument(request);
  await registryDocument(request);
  expect(urls[0]).not.toBe(urls[1]);
});
