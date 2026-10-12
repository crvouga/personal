/**
 * "How I build" — a method, not a toolchain.
 *
 * Every point is a principle that outlives the tools implementing it: it must
 * read the same to a hiring manager and to an engineer, and stay true if any
 * specific agent, language or CI product is swapped out. Compiler flags, lint
 * rules and vendor names are the implementation of these points, never the
 * points themselves.
 */

export const AGENTIC_CURSOR_BADGE = 'Recognized by Cursor';
export const AGENTIC_CURSOR_TEXT =
  'Cursor recognized me as one of its top Tab users and sent a custom Tab button as a gift. It is a measure of volume; the method is what makes that volume trustworthy.';

export const AGENTIC_WORKFLOW_TITLE = 'Specify first. Verify everything.';

export const AGENTIC_WORKFLOW_POINTS: readonly string[] = [
  '<strong>Start from the spec.</strong> Before anything is built I pin down what the change must do and how we will know it works. A clear spec is what makes work safe to delegate, to a teammate or to an AI agent.',
  '<strong>Make verification automatic.</strong> Every requirement that matters becomes a check a machine runs on every change, so correctness never depends on someone remembering to look.',
  '<strong>Let the pipeline decide.</strong> Nothing ships without passing continuous integration, no matter who or what wrote it. Agents draft; the pipeline is the gate.',
  '<strong>Own the outcome.</strong> Agents take on the repeatable work. The judgment and the accountability stay with me: if something wrong ships, it is mine.',
];
