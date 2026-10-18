// Pure part of `bun run health:fix`: turn a health report into findings and
// sort them into guided fixes and manual follow-ups.
import type {
  CheckStatus,
  HealthReport,
} from '../../packages/infra/lib/health/report';

export type Finding = {
  group: string;
  check: string;
  status: Exclude<CheckStatus, 'pass'>;
  detail: string;
};

export type Fixer = {
  id: string;
  title: string;
  /** Only failures and warnings are offered to fixers. */
  handles: (finding: Finding) => boolean;
  run: (findings: Finding[]) => Promise<void>;
};

export type Advice = { handles: (finding: Finding) => boolean; text: string };

export type Triage = {
  fixes: { fixer: Fixer; findings: Finding[] }[];
  manual: { finding: Finding; advice: string }[];
};

export const NO_GUIDED_FIX = 'No guided fix yet; investigate manually.';

export function findingsOf(report: HealthReport): Finding[] {
  return report.groups.flatMap((group) =>
    group.results.flatMap((result) =>
      result.status === 'pass'
        ? []
        : [
            {
              group: group.id,
              check: result.name,
              status: result.status,
              detail: result.detail,
            },
          ]
    )
  );
}

/** Each finding goes to the first fixer that takes it, else to manual advice. */
export function triage(
  findings: Finding[],
  fixers: Fixer[],
  advice: Advice[]
): Triage {
  const fixes = new Map<Fixer, Finding[]>();
  const manual: Triage['manual'] = [];
  for (const finding of findings) {
    const fixer =
      finding.status === 'skip'
        ? undefined
        : fixers.find((candidate) => candidate.handles(finding));
    if (fixer) fixes.set(fixer, [...(fixes.get(fixer) ?? []), finding]);
    else
      manual.push({
        finding,
        advice:
          advice.find((entry) => entry.handles(finding))?.text ?? NO_GUIDED_FIX,
      });
  }
  return {
    fixes: fixers.flatMap((fixer) =>
      fixes.has(fixer) ? [{ fixer, findings: fixes.get(fixer) ?? [] }] : []
    ),
    manual,
  };
}
