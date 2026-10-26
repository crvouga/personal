/**
 * Candidate information for recruiters' screening agents, generated from the
 * registry. The monorepo's infrastructure guide is `/llms-infra.txt`.
 */
import { buildLlmsTxt } from '../lib/candidate';

export const GET = (): Response =>
  new Response(buildLlmsTxt(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
