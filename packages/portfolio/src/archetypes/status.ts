/**
 * The state of the whole pipeline, as data: what each archetype's market asks
 * for, how well the knowledge base answers it, and what a human or an agent
 * should look at next. `bun run archetypes:status` prints it; the
 * `/portfolio-refresh` command reads it instead of the raw inputs, which is
 * what keeps a refresh cheap.
 */
import { PROJECT_FACTS } from '../knowledge/projects';
import { ROLES } from '../knowledge/roles';
import { THEME_IDS, type Theme } from '../knowledge/themes';
import {
  ARCHETYPES,
  DEFAULT_ARCHETYPE_ID,
  type ArchetypeId,
} from './definitions';
import { demandFor, opportunity, type Demand } from './demand';
import { LANDSCAPE } from './landscape';
import type { Landscape, SkillDemand } from './landscape-types';
import { VOICES } from './voice';

/** A voice answers its archetype's strongest themes; this many are "strongest". */
const TOP_THEMES = 8;
/** A landscape older than this no longer describes the current market. */
export const LANDSCAPE_STALE_DAYS = 45;
/** An uncovered segment this large may deserve its own archetype. */
const NOTABLE_SHARE = 0.05;
const DAY_MS = 86_400_000;

const themeWeight = (demand: Demand, theme: Theme): number =>
  (demand.themes.get(theme) ?? 0) * (demand.themeLift.get(theme) ?? 1);

const weightedThemes = (demand: Demand): Theme[] =>
  [...THEME_IDS].sort(
    (a, b) => themeWeight(demand, b) - themeWeight(demand, a)
  );

export type ArchetypeStatus = {
  readonly id: ArchetypeId;
  readonly postings: number;
  readonly share: number;
  readonly fit: number;
  readonly opportunity: number;
  readonly yearsMedian: number | null;
  readonly salaryMedian: number | null;
  /** Strongest first: share of postings × how distinctive it is here. */
  readonly topThemes: readonly Theme[];
  /** Themes the voice was written for that are no longer among the strongest. */
  readonly staleThemes: readonly string[];
};

export type Status = {
  readonly landscapeDate: string;
  readonly landscapeAgeDays: number;
  readonly archetypes: readonly ArchetypeStatus[];
  /** The archetype with the highest opportunity; ideally the default. */
  readonly bestDefault: ArchetypeId;
  /** Landscape segments no archetype covers, as `context/level (share)`. */
  readonly uncovered: readonly string[];
  /** Requested themes that no fact in the knowledge base is tagged with. */
  readonly unevidencedThemes: readonly Theme[];
  readonly skillGaps: readonly SkillDemand[];
  /** One line per thing that needs attention; empty means nothing to do. */
  readonly actions: readonly string[];
};

const archetypeStatus = (
  archetype: (typeof ARCHETYPES)[number],
  landscape: Landscape
): ArchetypeStatus => {
  const demand = demandFor(archetype, landscape);
  const topThemes = weightedThemes(demand).slice(0, TOP_THEMES);
  return {
    id: archetype.id,
    postings: demand.postings,
    share: demand.share,
    fit: demand.fit,
    opportunity: opportunity(demand),
    yearsMedian: demand.yearsMedian,
    salaryMedian: demand.salaryMedian,
    topThemes,
    staleThemes: VOICES[archetype.id].basedOn.filter(
      (theme) => !(topThemes as readonly string[]).includes(theme)
    ),
  };
};

const isCovered = (context: string, level: string): boolean =>
  ARCHETYPES.some((archetype) =>
    archetype.cells.some(
      (cell) =>
        cell.context === context &&
        (cell.levels as readonly string[]).includes(level)
    )
  );

const uncoveredSegments = (landscape: Landscape): string[] =>
  landscape.segments
    .filter(
      (segment) =>
        segment.share >= NOTABLE_SHARE &&
        !isCovered(segment.context, segment.level)
    )
    .map(
      (segment) =>
        `${segment.context}/${segment.level} (${(segment.share * 100).toFixed(0)}%)`
    );

const evidencedThemes = (): Set<Theme> =>
  new Set([
    ...PROJECT_FACTS.flatMap((project) => project.themes),
    ...ROLES.flatMap((role) =>
      role.achievements.flatMap((achievement) => achievement.themes)
    ),
  ]);

const ageAction = (status: Omit<Status, 'actions'>): string[] =>
  status.landscapeAgeDays > LANDSCAPE_STALE_DAYS
    ? [
        `landscape is ${String(status.landscapeAgeDays)} days old: run bun run market:refresh`,
      ]
    : [];

const defaultAction = (status: Omit<Status, 'actions'>): string[] =>
  status.bestDefault === DEFAULT_ARCHETYPE_ID
    ? []
    : [
        `default is ${DEFAULT_ARCHETYPE_ID} but ${status.bestDefault} now has the highest opportunity: reconsider DEFAULT_ARCHETYPE_ID`,
      ];

const actionsFor = (status: Omit<Status, 'actions'>): string[] => [
  ...ageAction(status),
  ...status.archetypes
    .filter((archetype) => archetype.staleThemes.length > 0)
    .map(
      (archetype) =>
        `voice ${archetype.id} leans on ${archetype.staleThemes.join(', ')}, no longer among its top themes: review its wording`
    ),
  ...defaultAction(status),
  ...status.uncovered.map(
    (segment) => `segment ${segment} has no archetype: consider adding one`
  ),
  ...status.unevidencedThemes.map(
    (theme) =>
      `no fact is tagged ${theme}: tag one, or ask Chris for the evidence`
  ),
];

export const statusOf = (
  landscape: Landscape = LANDSCAPE,
  now: Date = new Date()
): Status => {
  const archetypes = ARCHETYPES.map((archetype) =>
    archetypeStatus(archetype, landscape)
  );
  const evidenced = evidencedThemes();
  const best = [...archetypes].sort((a, b) => b.opportunity - a.opportunity)[0];
  const status = {
    landscapeDate: landscape.generatedAt,
    landscapeAgeDays: Math.floor(
      (now.getTime() - Date.parse(landscape.generatedAt)) / DAY_MS
    ),
    archetypes,
    bestDefault: best?.id ?? DEFAULT_ARCHETYPE_ID,
    uncovered: uncoveredSegments(landscape),
    unevidencedThemes: THEME_IDS.filter((theme) => !evidenced.has(theme)),
    skillGaps: landscape.gaps,
  };
  return { ...status, actions: actionsFor(status) };
};
