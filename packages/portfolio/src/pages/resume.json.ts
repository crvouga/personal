/** JSON Resume, generated from the registry on every build. */
import { buildResumeJson } from '../lib/candidate';

export const GET = (): Response =>
  new Response(`${JSON.stringify(buildResumeJson(), null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
