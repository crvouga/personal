export type Location = { file: string; line: number };
export type Summary = {
  job: string;
  command: string;
  locations: Location[];
  excerpt: string;
};
export function lastStep(
  log: string
): { command: string; output: string } | null;
export function locations(output: string, limit?: number): Location[];
export function summarize(input: { job: string; log: string }): Summary;
export function markdown(summary: Summary): string;
