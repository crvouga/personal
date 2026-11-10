/**
 * What a job title says: whether it is a software role at all, which kind,
 * and at what level. Tables are ordered; the first matching row wins.
 */
import type { JobFamily } from '../../src/roles/landscape-types';

const SOFTWARE =
  /\b(engineer|developer|architect|programmer|swe|sde|full[- ]?stack|front[- ]?end|back[- ]?end)\b/i;

const NOT_SOFTWARE =
  /\b(sales|solutions? engineer|support engineer|customer|success|field|mechanical|electrical|civil|manufactur|process engineer|network engineer|recruit|facilities|technician|pre-?sales|account|marketing|hardware|optical|chemical|structural|audio engineer|systems? administrator|landscape|construction)\b/i;

export const isEngineeringTitle = (title: string): boolean =>
  SOFTWARE.test(title) && !NOT_SOFTWARE.test(title);

export type { JobFamily };

const FAMILIES: readonly (readonly [JobFamily, RegExp])[] = [
  ['manager', /\b(manager|director|head of|vp|vice president)\b/i],
  [
    'ml-research',
    /\b(machine learning|ml|research|scientist|computer vision|nlp|deep learning|training|inference)\b/i,
  ],
  ['data', /\b(data|analytics|etl|database|dba|bi)\b/i],
  ['security', /\b(secur\w*|appsec|iam|cyber\w*|cryptograph\w*)\b/i],
  [
    'embedded',
    /\b(embedded|firmware|fpga|robotics|kernel|gpu|silicon|asic|rf|driver|simulation|avionics|autonomy|perception)\b/i,
  ],
  ['qa', /\b(qa|quality|test|sdet|automation engineer)\b/i],
  ['architect', /\barchitect\b/i],
  [
    'platform',
    /\b(devops|sre|site reliability|infrastructure|platform|cloud|kubernetes|release|reliability|systems engineer|developer (experience|productivity|tools))\b/i,
  ],
  ['mobile', /\b(ios|android|mobile|react native)\b/i],
  ['fullstack', /\b(full[- ]?stack|product engineer)\b/i],
  ['frontend', /\b(front[- ]?end|ui|ux|web|design engineer)\b/i],
  ['backend', /\b(back[- ]?end|api|server|distributed|services)\b/i],
  ['ai-product', /\b(ai|llm|agents?|genai|applied ai)\b/i],
];

export const familyOf = (title: string): JobFamily =>
  FAMILIES.find(([, pattern]) => pattern.test(title))?.[0] ?? 'generalist';

/** Roles a full-stack product engineer is a credible applicant for. */
export const RELEVANT_FAMILIES: ReadonlySet<JobFamily> = new Set<JobFamily>([
  'generalist',
  'fullstack',
  'frontend',
  'backend',
  'mobile',
  'architect',
  'platform',
  'ai-product',
]);

export type Level = 'junior' | 'mid' | 'senior' | 'staff';

const LEVELS: readonly (readonly [Level, RegExp])[] = [
  [
    'junior',
    /\b(intern(ship)?|junior|jr|new grad|graduate|entry[- ]level|apprentice|associate|early career|university)\b/i,
  ],
  [
    'staff',
    /\b(staff|principal|distinguished|fellow|architect|lead|founding)\b/i,
  ],
  ['senior', /\b(senior|sr|iii|iv)\b/i],
];

export const levelOf = (title: string): Level =>
  LEVELS.find(([, pattern]) => pattern.test(title))?.[0] ?? 'mid';
