/**
 * The cited research half of the market knowledge base: one research per
 * role, written from hiring-manager, recruiter and design research
 * (`/portfolio-refresh` step "research"), plus the market-wide findings.
 * Every file is parsed with zod at build time and every claim cites a source
 * the file lists.
 */
import {
  ResearchSchema,
  FindingsSchema,
  type RoleResearch,
  type Findings,
} from './schema';
import { RESEARCH_FILES } from './research/index';
import findings from './research/market.json';

export const RESEARCH: ReadonlyMap<string, RoleResearch> = new Map(
  Object.entries(RESEARCH_FILES).map(([id, raw]) => {
    const research = ResearchSchema.parse(raw);
    if (research.role !== id) {
      throw new Error(`research/${id}.json describes ${research.role}`);
    }
    return [id, research];
  })
);

export const FINDINGS: Findings = FindingsSchema.parse(findings);

export const researchFor = (id: string): RoleResearch => {
  const research = RESEARCH.get(id);
  if (research === undefined) {
    throw new Error(
      `No market research for ${id}: add src/market/research/${id}.json (bun run roles:new scaffolds it)`
    );
  }
  return research;
};
