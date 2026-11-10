/**
 * The knowledge base: everything true about Chris, with nothing about how it
 * is shown. No HTML, no image paths, no section names, no page order.
 *
 * Every fact carries `themes` (what it is evidence of, in an employer's
 * words) and, where it applies, `topics` (the technologies behind it). Those
 * two tags are all a presentation needs to rank facts for an audience.
 */
import type { Topic } from '../content/topic';
import type { Theme } from './themes';

/** A fact may carry at most this many themes: a tag on everything ranks nothing. */
export const MAX_THEMES_PER_FACT = 5;

/** `month` (1–12) is optional: a guessed month is worse than a visible year. */
export type YearMonth = { readonly year: number; readonly month?: number };

export type Achievement = {
  readonly id: string;
  /** One sentence, in the `text.ts` markup. */
  readonly text: string;
  readonly themes: readonly Theme[];
  readonly topics: readonly Topic[];
};

export type Role = {
  readonly id: string;
  readonly employer: string;
  readonly employerUrl?: string;
  readonly title: string;
  readonly start: YearMonth;
  readonly end: YearMonth | 'Present';
  readonly achievements: readonly Achievement[];
  readonly awards?: readonly string[];
  /** The role's stack, when its product is not also a project. */
  readonly topics?: readonly Topic[];
};

export type Code =
  { readonly t: 'private' } | { readonly t: 'public'; readonly url: string };

export type Deployment =
  | { readonly t: 'public'; readonly url: string }
  | { readonly t: 'not-deployed-anymore' }
  | { readonly t: 'not-deployed-yet' }
  | { readonly t: 'private' };

export type ProjectFact = {
  readonly id: string;
  readonly title: string;
  readonly setting: 'work' | 'side';
  readonly deployment: Deployment;
  readonly code: Code;
  /** Plain text, one or two sentences. */
  readonly description: string;
  readonly topics: readonly Topic[];
  readonly themes: readonly Theme[];
};

export type Degree = {
  readonly degree: string;
  readonly institution: string;
  readonly institutionUrl?: string;
  readonly yearStart: number;
  readonly yearEnd: number | 'Present';
};

/** A skill evidenced by something other than a project's stack. */
export type Capability = {
  /** A skill id from `scripts/market/skills.ts`. */
  readonly skill: string;
  /** The fact that backs it: a role, project or repository artifact. */
  readonly evidence: string;
};
