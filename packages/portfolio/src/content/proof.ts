/**
 * The proof section argues verification, not volume. Its figures are computed
 * from GitHub by a script (`scripts/refresh-verification.ts`) and rendered from
 * the committed snapshot; this prose only frames them, and states no number.
 */
export const PROOF_LEDE =
  'These figures come from GitHub, computed by a script rather than typed by me. They count what the pipeline checked and stopped, not how much I committed.';

/** Above the contribution calendar, which is volume and says so. */
export const PROOF_CALENDAR_NOTE =
  'Raw volume, for context: every contribution GitHub attributes to me, private repositories included. It shows activity, not quality.';

/**
 * The reason for an anomalous day, when Chris supplies one
 * (CONTENT_QUESTIONS.md). Without it the footnote states only what the data
 * shows: the date, the count, and the private-repository share.
 */
export const PROOF_ANOMALY_NOTE: string | undefined = undefined;
