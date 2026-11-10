/**
 * What a role is made of, in one place. Each role is one file in
 * `src/roles/by-id/`, holding everything about it that a script cannot
 * derive: which slice of the market it is, and the few hand-written lines of
 * its voice. Everything else is a function of the two knowledge bases:
 *
 * - the personal knowledge base (`src/knowledge/`): the facts, ranked;
 * - the market knowledge base (`src/market/`): the measured landscape (what
 *   postings ask for) and the cited market research for this role
 *   (`src/market/research/<id>.json`: what its readers scan for, the words
 *   they respond to, the résumé conventions and the look).
 *
 * `bun run roles:new <id>` scaffolds a file and its market research;
 * `bun run roles:sync` regenerates the story exports.
 */
import type { SectionId } from '../content/sections';
import type { VisualStyle } from '../design-system/palette';
import type { JobFamily } from './landscape-types';
import type { Context, SegmentLevel } from './landscape-types';
import type { ResumeSectionId } from '../market/schema';

/** A slice of the landscape: a hiring context, or a role family, by level. */
export type Cell =
  | {
      readonly context: Context;
      readonly levels: readonly SegmentLevel[];
    }
  | {
      readonly family: JobFamily;
      readonly levels: readonly SegmentLevel[];
    };

export type Voice = {
  /** The line above the name. */
  readonly eyebrow: string;
  /** The differentiator: the largest text after the name, and the summary. */
  readonly statement: string;
  /** Scope and domains: the résumé summary's second sentence. */
  readonly statementSecondary: string;
  readonly availability: string;
  /** Page order. Every section appears exactly once. */
  readonly sections: readonly SectionId[];
  /** Section headings that differ from the default wording. */
  readonly titles?: Partial<Record<SectionId, string>>;
  /** Résumé section headings that differ from the default wording. */
  readonly resumeTitles?: Partial<Record<ResumeSectionId, string>>;
  /**
   * The title line under the name on the résumé, in the words this segment
   * posts. Must stay true to the level held; defaults to the current title.
   */
  readonly headline?: string;
  /** The themes this voice was written to answer, strongest first. */
  readonly basedOn: readonly string[];
};

export type RoleSpec<Id extends string = string> = {
  /** Public: `/a/<id>/` is its URL. Shaped `<context>-<company>-<level>-<role>`. */
  readonly id: Id;
  /** One word: Storybook export names (`<Short>Dark`) and short labels. */
  readonly label: string;
  /** Who reads this presentation, in one phrase. */
  readonly audience: string;
  /** What this segment of the market is and what sets it apart. */
  readonly description: string;
  readonly cells: readonly Cell[];
  readonly voice: Voice;
  /**
   * Departures from the researched look (`visual` in the research), each with a
   * reason in a comment. Usually empty.
   */
  readonly style?: Partial<VisualStyle>;
};

/** Identity function that keeps the id a literal type. */
export const defineRole = <const Id extends string>(
  spec: RoleSpec<Id>
): RoleSpec<Id> => spec;
