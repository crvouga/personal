/**
 * Result model and renderers for the infrastructure health report.
 *
 * `skip` means a check could not run (missing credential or tool); it is never
 * a silent pass. `warn` is a degraded state that does not fail the report.
 */
import { assert } from "@pkgs/assert";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export type CheckResult = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

export type GroupReport = {
  readonly id: string;
  readonly title: string;
  readonly durationMs: number;
  readonly results: readonly CheckResult[];
};

export type HealthReport = {
  readonly zone: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly groups: readonly GroupReport[];
};

export type StatusCounts = Readonly<Record<CheckStatus, number>>;

export const pass = (name: string, detail: string): CheckResult => ({ name, status: "pass", detail });
export const warn = (name: string, detail: string): CheckResult => ({ name, status: "warn", detail });
export const fail = (name: string, detail: string): CheckResult => ({ name, status: "fail", detail });
export const skip = (name: string, detail: string): CheckResult => ({ name, status: "skip", detail });

const STATUSES: readonly CheckStatus[] = ["pass", "warn", "fail", "skip"];
const ICON: Readonly<Record<CheckStatus, string>> = { pass: "✓", warn: "!", fail: "✗", skip: "–" };
const EMOJI: Readonly<Record<CheckStatus, string>> = { pass: "✅", warn: "⚠️", fail: "❌", skip: "⏭️" };
const COLOR: Readonly<Record<CheckStatus, string>> = { pass: "32", warn: "33", fail: "31", skip: "90" };

export function countStatuses(results: readonly CheckResult[]): StatusCounts {
  assert.array(results, "results must be an array");
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const result of results) counts[result.status]++;
  return counts;
}

export function reportCounts(report: HealthReport): StatusCounts {
  assert.record(report, "report must be a record");
  return countStatuses(report.groups.flatMap((group) => group.results));
}

/** The status a group shows at a glance: its worst result. */
export function groupStatus(results: readonly CheckResult[]): CheckStatus {
  const counts = countStatuses(results);
  if (counts.fail > 0) return "fail";
  if (counts.warn > 0) return "warn";
  if (counts.pass > 0) return "pass";
  return "skip";
}

/** Failures always fail; `strict` also refuses warnings and skipped checks. */
export function reportExitCode(report: HealthReport, strict: boolean): number {
  const counts = reportCounts(report);
  if (counts.fail > 0) return 1;
  if (strict && counts.warn + counts.skip > 0) return 1;
  return 0;
}

function verdictStatus(counts: StatusCounts): CheckStatus {
  return counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
}

/** Skipped checks are named in the verdict so a partial run never reads as a clean bill. */
function verdict(counts: StatusCounts): string {
  const word = counts.fail > 0 ? "Unhealthy" : counts.warn > 0 ? "Degraded" : "Healthy";
  return counts.skip > 0 ? `${word}, ${counts.skip} not checked` : word;
}

function formatCounts(counts: StatusCounts): string {
  return STATUSES.filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${status}`)
    .join(" · ");
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export type TextOptions = { readonly verbose: boolean; readonly color: boolean };

export function renderText(report: HealthReport, options: TextOptions): string {
  assert.record(report, "report must be a record");
  const paint = (status: CheckStatus, text: string): string =>
    options.color ? `\u001b[${COLOR[status]}m${text}\u001b[0m` : text;
  const width = Math.max(...report.groups.map((group) => group.title.length), 0);
  const lines = [`Infra health · ${report.zone} · ${report.startedAt}`, ""];

  for (const group of report.groups) {
    const status = groupStatus(group.results);
    const counts = formatCounts(countStatuses(group.results)) || "no checks";
    lines.push(`${paint(status, ICON[status])} ${group.title.padEnd(width)}  ${counts}`);
    for (const result of group.results) {
      if (result.status === "pass" && !options.verbose) continue;
      lines.push(`    ${paint(result.status, ICON[result.status])} ${result.name} — ${result.detail}`);
    }
  }

  const counts = reportCounts(report);
  const status = verdictStatus(counts);
  lines.push("", `${paint(status, verdict(counts).toUpperCase())}  ${formatCounts(counts)}  (${formatSeconds(report.durationMs)})`);
  if (counts.skip > 0) lines.push("Skipped checks did not run; see each line for the missing credential or flag.");
  return lines.join("\n");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** GitHub-flavored markdown, written to the Actions job summary. */
export function renderMarkdown(report: HealthReport): string {
  assert.record(report, "report must be a record");
  const counts = reportCounts(report);
  const lines = [
    `## Infra health · ${report.zone}`,
    "",
    `**${EMOJI[verdictStatus(counts)]} ${verdict(counts)}** — ${formatCounts(counts)} (${formatSeconds(report.durationMs)}, ${report.startedAt})`,
    "",
    "| | Area | Pass | Warn | Fail | Skip |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const group of report.groups) {
    const c = countStatuses(group.results);
    lines.push(`| ${EMOJI[groupStatus(group.results)]} | ${group.title} | ${c.pass} | ${c.warn} | ${c.fail} | ${c.skip} |`);
  }

  const attention = report.groups.flatMap((group) =>
    group.results
      .filter((result) => result.status !== "pass")
      .map((result) => `| ${EMOJI[result.status]} | ${group.title} | ${escapeCell(result.name)} | ${escapeCell(result.detail)} |`),
  );
  if (attention.length > 0) {
    lines.push("", "### Needs attention", "", "| | Area | Check | Detail |", "| --- | --- | --- | --- |", ...attention);
  }

  lines.push("", "<details><summary>All checks</summary>", "");
  for (const group of report.groups) {
    lines.push(`**${group.title}**`, "");
    for (const result of group.results) {
      lines.push(`- ${EMOJI[result.status]} \`${result.name}\` — ${result.detail}`);
    }
    lines.push("");
  }
  lines.push("</details>", "");
  return lines.join("\n");
}
