/**
 * The market knowledge base: what the job market wants, as data.
 *
 * - `landscape`: measured. Job postings sampled from public boards and
 *   aggregated into skill, theme and phrase demand per segment
 *   (`bun run market:refresh`; never edited by hand).
 * - `research` and `findings`: researched. Cited, per-role research on what
 *   each kind of reader scans for, the words and résumé conventions that work
 *   on them and the look that fits them, and market-wide trends.
 *
 * The personal knowledge base (`src/knowledge/`) is the other input. A
 * presentation, a résumé and the gap analysis are functions of the two.
 */
import { LANDSCAPE } from '../roles/landscape';
import { RESEARCH, FINDINGS, researchFor } from './research';

export const MARKET = {
  landscape: LANDSCAPE,
  research: RESEARCH,
  findings: FINDINGS,
} as const;

export { researchFor };
export type {
  RoleResearch,
  Findings,
  Criterion,
  Source,
  Visual,
} from './schema';
