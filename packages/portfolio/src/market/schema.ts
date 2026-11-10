/**
 * The shape of the qualitative half of the market knowledge base: cited
 * market research, one per role, and the market-wide findings. Parsed
 * with zod at build time, so a malformed or uncited entry fails the build
 * instead of rendering.
 */
import { z } from 'zod';

import { SKILLS } from '../roles/skills';
import { THEME_IDS, type Theme } from '../knowledge/themes';

const SKILL_IDS = SKILLS.map((skill) => skill.id) as [string, ...string[]];

export const ThemeId = z.enum(THEME_IDS as [Theme, ...Theme[]]);
export const SkillId = z.enum(SKILL_IDS);

export const SourceSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
});

/** Indexes into the file's own `sources`; at least one per claim. */
const Cited = z.array(z.number().int().nonnegative()).min(1);

export const CriterionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  why: z.string().min(1),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  themes: z.array(ThemeId).min(1).max(3),
  skills: z.array(SkillId).max(4),
  howToDemonstrate: z.string().min(1),
  sources: Cited,
});

export const VisualSchema = z.object({
  tone: z.string().min(1),
  scheme: z.enum(['dark', 'light', 'auto']),
  hue: z.number().min(0).max(360),
  chroma: z.enum(['muted', 'moderate', 'vivid']),
  display: z.enum(['sans', 'serif', 'mono']),
  accent: z.enum(['sans', 'mono']),
  corners: z.enum(['square', 'soft', 'round']),
  density: z.enum(['compact', 'comfortable', 'airy']),
  rationale: z.string().min(1),
  sources: Cited,
});

export const RESUME_SECTION_IDS = [
  'summary',
  'competencies',
  'experience',
  'projects',
  'skills',
  'education',
] as const;
export type ResumeSectionId = (typeof RESUME_SECTION_IDS)[number];

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ResearchSchema = z.object({
  role: z.string().regex(/^[a-z0-9-]+$/),
  /** When the research was done; `roles:status` flags old research. */
  asOf: IsoDate,
  summary: z.string().min(1),
  readers: z
    .array(
      z.object({
        who: z.string(),
        firstPassSeconds: z.number().nullable(),
        scansFor: z.string(),
      })
    )
    .min(1),
  criteria: z.array(CriterionSchema).min(6),
  redFlags: z
    .array(z.object({ label: z.string(), why: z.string(), sources: Cited }))
    .min(3),
  vocabulary: z.object({
    prefer: z.array(z.string()).min(5),
    avoid: z.array(z.string()).min(3),
    verbs: z.array(z.string()).min(5),
    titles: z.array(z.string()).min(2),
  }),
  resume: z.object({
    pages: z.union([z.literal(1), z.literal(2)]),
    summaryStyle: z.string(),
    sectionOrder: z.array(z.enum(RESUME_SECTION_IDS)).min(4),
    bulletFormula: z.string(),
    keywordStrategy: z.string(),
    notes: z.array(z.string()),
    sources: Cited,
  }),
  portfolio: z.object({
    leadWith: z.string(),
    mustHave: z.array(z.string()),
    notes: z.array(z.string()),
    sources: Cited,
  }),
  visual: VisualSchema,
  interview: z.array(z.string()),
  sources: z.array(SourceSchema).min(5),
});

export const FindingsSchema = z.object({
  asOf: z.string(),
  trends: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      finding: z.string(),
      implication: z.string(),
      themes: z.array(ThemeId),
      skills: z.array(SkillId),
      sources: Cited,
    })
  ),
  universalCriteria: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      why: z.string(),
      themes: z.array(ThemeId),
      howToDemonstrate: z.string(),
      sources: Cited,
    })
  ),
  resumeRules: z.array(
    z.object({ rule: z.string(), why: z.string(), sources: Cited })
  ),
  skillOutlook: z.array(
    z.object({
      skill: z.string(),
      direction: z.enum(['rising', 'steady', 'falling']),
      note: z.string(),
      sources: Cited,
    })
  ),
  recommendations: z.array(
    z.object({
      gap: z.string(),
      move: z.string(),
      effort: z.enum(['days', 'weeks', 'months']),
      payoff: z.string(),
      sources: Cited,
    })
  ),
  sources: z.array(SourceSchema).min(5),
});

export type RoleResearch = z.infer<typeof ResearchSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type Findings = z.infer<typeof FindingsSchema>;
export type Source = z.infer<typeof SourceSchema>;

/** Every `sources` index in a role's research points at a source it lists. */
export const danglingCitations = (
  sources: readonly unknown[],
  cited: readonly (readonly number[])[]
): number[] => cited.flat().filter((index) => index >= sources.length);
