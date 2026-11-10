/**
 * The state of the whole pipeline, as data: what each role's market asks
 * for, how well the knowledge base answers it, and what a human or an agent
 * should look at next. `bun run roles:status` prints it; the
 * `/portfolio-refresh` command reads it instead of the raw inputs, which is
 * what keeps a refresh cheap.
 */
import { PROJECT_FACTS } from '../knowledge/projects';
import { JOBS } from '../knowledge/jobs';
import { THEME_IDS, type Theme } from '../knowledge/themes';
import { ROLES, DEFAULT_ROLE_ID, type RoleId } from './definitions';
import { demandFor, opportunity, type Demand } from './demand';
import { LANDSCAPE } from './landscape';
import type { Landscape, SkillDemand } from './landscape-types';
import { VOICES } from './voice';
import { RESEARCH } from '../market/research';

/** A voice answers its role's strongest themes; this many are "strongest". */
const TOP_THEMES = 8;
/** A landscape older than this no longer describes the current market. */
export const LANDSCAPE_STALE_DAYS = 45;
/** Research older than this may no longer describe how readers screen. */
export const RESEARCH_STALE_DAYS = 180;
/** An uncovered segment this large may deserve its own role. */
const NOTABLE_SHARE = 0.05;
const DAY_MS = 86_400_000;

const themeWeight = (demand: Demand, theme: Theme): number =>
  (demand.themes.get(theme) ?? 0) * (demand.themeLift.get(theme) ?? 1);

const weightedThemes = (demand: Demand): Theme[] =>
  [...THEME_IDS].sort(
    (a, b) => themeWeight(demand, b) - themeWeight(demand, a)
  );

export type RoleStatus = {
  readonly id: RoleId;
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
  readonly roles: readonly RoleStatus[];
  /** The role with the highest opportunity; ideally the default. */
  readonly bestDefault: RoleId;
  /** Landscape segments no role covers, as `context/level (share)`. */
  readonly uncovered: readonly string[];
  /** Requested themes that no fact in the knowledge base is tagged with. */
  readonly unevidencedThemes: readonly Theme[];
  readonly skillGaps: readonly SkillDemand[];
  /** Roles whose market research is older than `RESEARCH_STALE_DAYS`. */
  readonly staleResearch: readonly string[];
  /** One line per thing that needs attention; empty means nothing to do. */
  readonly actions: readonly string[];
};

const roleStatus = (
  role: (typeof ROLES)[number],
  landscape: Landscape
): RoleStatus => {
  const demand = demandFor(role, landscape);
  const topThemes = weightedThemes(demand).slice(0, TOP_THEMES);
  return {
    id: role.id,
    postings: demand.postings,
    share: demand.share,
    fit: demand.fit,
    opportunity: opportunity(demand),
    yearsMedian: demand.yearsMedian,
    salaryMedian: demand.salaryMedian,
    topThemes,
    staleThemes: VOICES[role.id].basedOn.filter(
      (theme) => !(topThemes as readonly string[]).includes(theme)
    ),
  };
};

const isCovered = (context: string, level: string): boolean =>
  ROLES.some((role) =>
    role.cells.some(
      (cell) =>
        'context' in cell &&
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
    ...JOBS.flatMap((job) =>
      job.achievements.flatMap((achievement) => achievement.themes)
    ),
  ]);

const ageAction = (status: Omit<Status, 'actions'>): string[] =>
  status.landscapeAgeDays > LANDSCAPE_STALE_DAYS
    ? [
        `landscape is ${String(status.landscapeAgeDays)} days old: run bun run market:refresh`,
      ]
    : [];

const defaultAction = (status: Omit<Status, 'actions'>): string[] =>
  status.bestDefault === DEFAULT_ROLE_ID
    ? []
    : [
        `default is ${DEFAULT_ROLE_ID} but ${status.bestDefault} now has the highest opportunity: reconsider DEFAULT_ROLE_ID`,
      ];

const actionsFor = (status: Omit<Status, 'actions'>): string[] => [
  ...ageAction(status),
  ...status.roles
    .filter((role) => role.staleThemes.length > 0)
    .map(
      (role) =>
        `voice ${role.id} leans on ${role.staleThemes.join(', ')}, no longer among its top themes: review its wording`
    ),
  ...defaultAction(status),
  ...status.staleResearch.map(
    (id) =>
      `market research ${id} is over ${String(RESEARCH_STALE_DAYS)} days old: re-run its research (src/market/research/${id}.json)`
  ),
  ...status.uncovered.map(
    (segment) => `segment ${segment} has no role: consider adding one`
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
  const roles = ROLES.map((role) => roleStatus(role, landscape));
  const evidenced = evidencedThemes();
  const best = [...roles].sort((a, b) => b.opportunity - a.opportunity)[0];
  const status = {
    landscapeDate: landscape.generatedAt,
    landscapeAgeDays: Math.floor(
      (now.getTime() - Date.parse(landscape.generatedAt)) / DAY_MS
    ),
    roles,
    bestDefault: best?.id ?? DEFAULT_ROLE_ID,
    uncovered: uncoveredSegments(landscape),
    unevidencedThemes: THEME_IDS.filter((theme) => !evidenced.has(theme)),
    skillGaps: landscape.gaps,
    staleResearch: [...RESEARCH.values()]
      .filter(
        (research) =>
          (now.getTime() - Date.parse(research.asOf)) / DAY_MS >
          RESEARCH_STALE_DAYS
      )
      .map((research) => research.role),
  };
  return { ...status, actions: actionsFor(status) };
};
