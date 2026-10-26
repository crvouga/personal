import type { Receipt } from '../agentic';

/**
 * The standard case-study format. Every flagship is told the same way so a
 * reviewer can compare them, and `case-studies.test.ts` enforces it: every
 * section present, 350–600 words of prose, no typed numbers (outcome figures
 * are rendered from the committed snapshots), and links that resolve.
 */
export type CaseStudy = {
  /** The project this tells; it must exist in PROJECTS. */
  readonly projectId: string;
  /** URL segment: `/projects/<slug>/`. */
  readonly slug: string;
  /** Page title and `<h1>`. */
  readonly title: string;
  /** One line: why it matters. Shown under the homepage card. */
  readonly subline: string;
  /** Meta description and share-card text; one sentence. */
  readonly description: string;
  readonly problem: readonly string[];
  /** Rendered as a list. */
  readonly constraints: readonly string[];
  readonly design: readonly string[];
  /** "How correctness is enforced" — the section the format exists for. */
  readonly correctness: readonly string[];
  /** Framing for the derived outcome figures, which carry the numbers. */
  readonly outcome: readonly string[];
  readonly differently: readonly string[];
  readonly links: readonly Receipt[];
  readonly hero: {
    readonly src: string;
    readonly alt: string;
    readonly width: number;
    readonly height: number;
  };
};

/** Section headings, in the order every case study renders them. */
export const CASE_STUDY_SECTIONS = [
  ['problem', 'Problem'],
  ['constraints', 'Constraints'],
  ['design', 'Design'],
  ['correctness', 'How correctness is enforced'],
  ['outcome', 'Outcome'],
  ['differently', 'What I would do differently'],
] as const satisfies readonly (readonly [keyof CaseStudy, string])[];
