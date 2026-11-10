/**
 * Voice: the hand-written words of one role's presentation, kept in its
 * role file (`src/roles/by-id/<id>.ts`).
 *
 * Everything else a presentation shows is ranked from the knowledge base;
 * these few lines are the part a script cannot derive. They restate facts the
 * knowledge base already holds, in the vocabulary that role's postings
 * and market research use, and obey the same copy rules as the rest of the
 * site (`roles.test.ts`): no typed numbers, years or technology names,
 * and none of the words the research says this reader distrusts.
 *
 * `basedOn` records the inputs a voice was written against, so
 * `bun run roles:status` can tell which voices a market or knowledge
 * change has made stale. Only those need rewriting.
 */
import { ROLE_DEFINITIONS } from './by-id/index';
import type { Voice } from './define';
import type { RoleId } from './definitions';

export type { Voice };

export const VOICES: Readonly<Record<RoleId, Voice>> = Object.fromEntries(
  ROLE_DEFINITIONS.map((role) => [role.id, role.voice])
) as Record<RoleId, Voice>;
