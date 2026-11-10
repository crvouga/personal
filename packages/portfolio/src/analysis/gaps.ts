/**
 * Where Chris falls short of what the market wants: the personal knowledge
 * base (`src/knowledge/`) set against the market knowledge base
 * (`src/market/`). A pure function of the two, rendered on the unlisted
 * `/gaps/` page, so it moves the moment either changes: a new fact closes a
 * gap, a market refresh opens one.
 *
 * Three lenses, from hardest evidence to softest:
 * - measured: skills and themes the sampled postings ask for that no fact backs;
 * - researched: the criteria each role's readers scan for (its market research),
 *   graded by how much evidence the knowledge base holds for each;
 * - wording: phrases the postings use that nothing on the site says, and
 *   words the research says that reader distrusts.
 */
import { ROLE_DEFINITIONS } from '../roles/by-id/index';
import type { RoleSpec } from '../roles/define';
import type { RoleId } from '../roles/definitions';
import { demandFor, opportunity, type Demand } from '../roles/demand';
import { SKILLS } from '../roles/skills';
import { PERSONAL, yearsOfExperience, type Fact } from '../knowledge/index';
import { THEMES, THEME_IDS, type Theme } from '../knowledge/themes';
import { MARKET } from '../market/index';
import type {
  RoleResearch,
  Findings,
  Criterion,
  Source,
} from '../market/schema';

export type Coverage = 'shown' | 'partial' | 'missing';

/** How much of a criterion's weight its coverage earns. */
const CREDIT: Readonly<Record<Coverage, number>> = {
  shown: 1,
  partial: 0.5,
  missing: 0,
};
/**
 * Themes whose proof is public by nature: a repository, a written policy, a
 * post. For these a side project is evidence enough; for the rest a reader
 * wants it done in a paid role.
 */
const PUBLIC_PROOF: ReadonlySet<Theme> = new Set<Theme>([
  'open-source',
  'ai-assisted',
  'documentation',
]);
/** Facts on the primary theme that make a criterion shown. */
const PROVEN_FACTS = 2;
const TOP_THEMES = 8;
const TOP_SKILLS = 8;
const TOP_PHRASES = 14;
const TOP_ACTIONS = 12;

export type CriterionCheck = {
  readonly criterion: Criterion;
  readonly coverage: Coverage;
  /** Facts tagged with the criterion's primary theme. */
  readonly evidence: readonly Fact[];
  /** Facts on its other themes only: related, not the thing itself. */
  readonly related: readonly Fact[];
  readonly skillsHave: readonly string[];
  readonly skillsMissing: readonly string[];
  readonly sources: readonly Source[];
};

export type ThemeGap = {
  readonly theme: Theme;
  readonly label: string;
  readonly share: number;
  readonly lift: number;
  readonly facts: number;
};

export type SkillGap = {
  readonly id: string;
  readonly label: string;
  readonly share: number;
  readonly direction: 'rising' | 'steady' | 'falling' | null;
  readonly note: string | null;
};

export type PhraseUse = {
  readonly text: string;
  readonly share: number;
  readonly used: boolean;
};

export type RoleGaps = {
  readonly id: string;
  readonly label: string;
  readonly audience: string;
  readonly summary: string;
  readonly postings: number;
  readonly opportunity: number;
  readonly salaryMedian: number | null;
  readonly yearsAsked: number | null;
  readonly yearsHeld: number;
  /** Weighted share of the role's hiring criteria the knowledge base backs, 0–1. */
  readonly readiness: number;
  /** Share of all sampled postings that fall in this role. */
  readonly share: number;
  /** Mean share of a posting's named skills the knowledge base backs, 0–1. */
  readonly fit: number;
  /** How many criteria are shown, partly shown and not shown. */
  readonly counts: Readonly<Record<Coverage, number>>;
  /** Plain-language caveats a percentage alone would hide. */
  readonly notes: readonly string[];
  readonly criteria: readonly CriterionCheck[];
  readonly themes: readonly ThemeGap[];
  readonly skills: readonly SkillGap[];
  readonly phrases: readonly PhraseUse[];
  /** Words the research says this reader distrusts, found in its voice. */
  readonly avoidHits: readonly string[];
  readonly redFlags: RoleResearch['redFlags'];
  readonly sources: readonly Source[];
};

export type Action = {
  readonly role: string;
  readonly label: string;
  readonly move: string;
  readonly coverage: Coverage;
  readonly priority: number;
};

export type GapReport = {
  readonly asOf: string;
  readonly landscapeDate: string;
  readonly postings: number;
  readonly yearsHeld: number;
  readonly roles: readonly RoleGaps[];
  /** Highest payoff first: criterion weight × role opportunity × what is missing. */
  readonly actions: readonly Action[];
  readonly skillGaps: readonly SkillGap[];
  readonly unevidencedThemes: readonly { theme: Theme; label: string }[];
  /** Work achievements that state a measured result; every research asks for one. */
  readonly quantified: { readonly count: number; readonly total: number };
  readonly findings: Findings;
};

const lower = (text: string): string => text.toLowerCase();

const outlookFor = (
  findings: Findings,
  skillId: string,
  label: string
): Pick<SkillGap, 'direction' | 'note'> => {
  const row = findings.skillOutlook.find(
    (entry) =>
      lower(entry.skill) === skillId || lower(entry.skill) === lower(label)
  );
  return { direction: row?.direction ?? null, note: row?.note ?? null };
};

const skillLabel = (id: string): string =>
  SKILLS.find((skill) => skill.id === id)?.label ?? id;

export const checkCriterion = (
  criterion: Criterion,
  research: RoleResearch,
  facts: readonly Fact[] = PERSONAL.facts,
  skills: ReadonlySet<string> = PERSONAL.skills
): CriterionCheck => {
  const [primary] = criterion.themes;
  const evidence = facts.filter((fact) =>
    fact.themes.includes(primary as Theme)
  );
  const related = facts.filter(
    (fact) =>
      !evidence.includes(fact) &&
      fact.themes.some((theme) => criterion.themes.includes(theme))
  );
  const skillsHave = criterion.skills.filter((skill) => skills.has(skill));
  const skillsMissing = criterion.skills.filter((skill) => !skills.has(skill));
  const shown =
    evidence.length >= PROVEN_FACTS &&
    (PUBLIC_PROOF.has(primary as Theme) ||
      evidence.some((fact) => fact.professional)) &&
    skillsMissing.length === 0;
  const coverage: Coverage = shown
    ? 'shown'
    : evidence.length + related.length > 0 || skillsHave.length > 0
      ? 'partial'
      : 'missing';
  return {
    criterion,
    coverage,
    evidence,
    related,
    skillsHave,
    skillsMissing,
    sources: criterion.sources.flatMap(
      (index) => research.sources[index] ?? []
    ),
  };
};

/** Weighted share of criteria backed, 0–1. */
export const readinessOf = (criteria: readonly CriterionCheck[]): number => {
  const total = criteria.reduce((sum, row) => sum + row.criterion.weight, 0);
  const earned = criteria.reduce(
    (sum, row) => sum + row.criterion.weight * CREDIT[row.coverage],
    0
  );
  return total === 0 ? 0 : earned / total;
};

const voiceText = (spec: RoleSpec<RoleId>): string =>
  [
    spec.voice.eyebrow,
    spec.voice.statement,
    spec.voice.statementSecondary,
    spec.voice.availability,
    spec.voice.headline ?? '',
    ...Object.values(spec.voice.titles ?? {}),
  ].join(' ');

/** Whole-phrase match, so "ai" does not hit "maintain". */
const mentions = (haystack: string, phrase: string): boolean =>
  new RegExp(
    `(^|[^a-z0-9])${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`
  ).test(haystack);

const countsOf = (
  criteria: readonly CriterionCheck[]
): Record<Coverage, number> => ({
  shown: criteria.filter((row) => row.coverage === 'shown').length,
  partial: criteria.filter((row) => row.coverage === 'partial').length,
  missing: criteria.filter((row) => row.coverage === 'missing').length,
});

/** Readiness at or above this reads as a strong match on criteria alone. */
const HIGH_READINESS = 0.8;
/** Below this, the role is a stretch on evidence, not only on years. */
const LOW_READINESS = 0.65;
const pct = (value: number): string => `${String(Math.round(value * 100))}%`;

/**
 * What the percentage does not say: a years-of-experience gap, the criteria
 * that hold it down, and how to read a high score.
 */
export const readinessNotes = ({
  readiness,
  yearsAsked,
  yearsHeld,
  criteria,
}: {
  readonly readiness: number;
  readonly yearsAsked: number | null;
  readonly yearsHeld: number;
  readonly criteria: readonly CriterionCheck[];
}): string[] => {
  const notes: string[] = [];
  const asked = yearsAsked === null ? null : Math.round(yearsAsked);
  if (asked !== null && asked > yearsHeld) {
    notes.push(
      readiness >= HIGH_READINESS
        ? `Scores ${pct(readiness)} on hiring criteria, but its postings ask for a median of ${String(asked)} years and you have ${String(yearsHeld)}: the gap is years, not evidence.`
        : `Its postings also ask for a median of ${String(asked)} years and you have ${String(yearsHeld)}.`
    );
  } else if (asked !== null) {
    notes.push(
      `Its postings ask for a median of ${String(asked)} years; you have ${String(yearsHeld)}, so years are not the obstacle.`
    );
  }
  const decisive = criteria.filter(
    (row) => row.criterion.weight === 3 && row.coverage !== 'shown'
  );
  if (decisive.length > 0) {
    notes.push(
      `Decisive criteria not fully shown: ${decisive.map((row) => row.criterion.label).join('; ')}.`
    );
  }
  if (readiness < LOW_READINESS) {
    notes.push(
      'The weakest match: most of what these hiring managers screen for is shown only by side projects or related work, not in a paid job.'
    );
  } else if (readiness >= HIGH_READINESS) {
    notes.push(
      'A high score means the right kinds of evidence exist; most still lack a number (see measured results below).'
    );
  }
  return notes;
};

const themeGaps = (demand: Demand, facts: readonly Fact[]): ThemeGap[] =>
  THEME_IDS.map((theme) => ({
    theme,
    label: THEMES[theme],
    share: demand.themes.get(theme) ?? 0,
    lift: demand.themeLift.get(theme) ?? 1,
    facts: facts.filter((fact) => fact.themes.includes(theme)).length,
  }))
    .sort((a, b) => b.share * b.lift - a.share * a.lift)
    .slice(0, TOP_THEMES);

const skillGaps = (demand: Demand, findings: Findings): SkillGap[] =>
  [...demand.skills]
    .filter(([id]) => !PERSONAL.skills.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SKILLS)
    .map(([id, share]) => ({
      id,
      label: skillLabel(id),
      share,
      ...outlookFor(findings, id, skillLabel(id)),
    }));

/** The phrases its employers use most, and whether anything here says them. */
const phraseUses = (
  demand: Demand,
  spec: RoleSpec<RoleId>,
  facts: readonly Fact[]
): PhraseUse[] => {
  const said = lower(
    [voiceText(spec), ...facts.map((fact) => fact.text)].join(' ')
  );
  return [...demand.phrases]
    .sort(
      (a, b) =>
        b[1] * Math.min(demand.phraseLift.get(b[0]) ?? 1, 3) -
        a[1] * Math.min(demand.phraseLift.get(a[0]) ?? 1, 3)
    )
    .slice(0, TOP_PHRASES)
    .map(([text, share]) => ({ text, share, used: mentions(said, text) }));
};

const roleGaps = (
  spec: RoleSpec<RoleId>,
  facts: readonly Fact[],
  findings: Findings,
  now: Date
): RoleGaps => {
  const research = MARKET.research.get(spec.id);
  if (research === undefined) throw new Error(`no research for ${spec.id}`);
  const demand = demandFor(spec);
  const criteria = research.criteria
    .map((criterion) => checkCriterion(criterion, research, facts))
    .sort(
      (a, b) =>
        b.criterion.weight - a.criterion.weight ||
        CREDIT[a.coverage] - CREDIT[b.coverage]
    );
  const themes = themeGaps(demand, facts);
  const skills = skillGaps(demand, findings);
  const phrases = phraseUses(demand, spec, facts);
  const voice = lower(voiceText(spec));
  return {
    id: spec.id,
    label: spec.label,
    audience: spec.audience,
    summary: research.summary,
    postings: demand.postings,
    opportunity: opportunity(demand),
    salaryMedian: demand.salaryMedian,
    yearsAsked: demand.yearsMedian,
    yearsHeld: yearsOfExperience(now),
    readiness: readinessOf(criteria),
    share: demand.share,
    fit: demand.fit,
    counts: countsOf(criteria),
    notes: readinessNotes({
      readiness: readinessOf(criteria),
      yearsAsked: demand.yearsMedian,
      yearsHeld: yearsOfExperience(now),
      criteria,
    }),
    criteria,
    themes,
    skills,
    phrases,
    avoidHits: research.vocabulary.avoid.filter((word) =>
      mentions(voice, word)
    ),
    redFlags: research.redFlags,
    sources: research.sources,
  };
};

const actionsOf = (roles: readonly RoleGaps[]): Action[] => {
  const best = new Map<string, Action>();
  for (const role of roles) {
    for (const row of role.criteria) {
      if (row.coverage === 'shown') continue;
      const action: Action = {
        role: role.label,
        label: row.criterion.label,
        move: row.criterion.howToDemonstrate,
        coverage: row.coverage,
        priority:
          row.criterion.weight * role.opportunity * (1 - CREDIT[row.coverage]),
      };
      // The same ask from several roles is one action, at its best payoff.
      const key = lower(row.criterion.label);
      const kept = best.get(key);
      if (kept === undefined || kept.priority < action.priority) {
        best.set(key, action);
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label))
    .slice(0, TOP_ACTIONS);
};

export const gapReport = (now: Date = new Date()): GapReport => {
  const { findings, landscape } = MARKET;
  const facts = PERSONAL.facts;
  const roles = ROLE_DEFINITIONS.map((spec) =>
    roleGaps(spec, facts, findings, now)
  ).sort((a, b) => b.opportunity - a.opportunity);
  const evidenced = new Set(facts.flatMap((fact) => fact.themes));
  return {
    asOf: findings.asOf,
    landscapeDate: landscape.generatedAt,
    postings: landscape.totals.eligible,
    yearsHeld: yearsOfExperience(now),
    roles,
    actions: actionsOf(roles),
    skillGaps: landscape.gaps.map((gap) => ({
      id: gap.id,
      label: gap.label,
      share: gap.share,
      ...outlookFor(findings, gap.id, gap.label),
    })),
    quantified: {
      count: facts.filter(
        (fact) => fact.kind === 'achievement' && /\d/.test(fact.text)
      ).length,
      total: facts.filter((fact) => fact.kind === 'achievement').length,
    },
    unevidencedThemes: THEME_IDS.filter((theme) => !evidenced.has(theme)).map(
      (theme) => ({ theme, label: THEMES[theme] })
    ),
    findings,
  };
};
