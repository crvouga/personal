export type Progress = {
  readonly domain: string;
  readonly state: 'blocked' | 'waiting' | 'complete';
  readonly detail: string;
  readonly findings?: readonly string[];
};

export function gateProgress(domain: string, findings: readonly string[]): Progress {
  const timersOnly = findings.length > 0 && findings.every((value) =>
    /^(DNS freeze and cache wait|DNSSEC removal and cache wait|Delegation soak): (freezeStartedAt|dsAbsentSince|delegationChangedAt): wait until \d{4}-\d\d-\d\dT/.test(value));
  return { domain, state: timersOnly ? 'waiting' : 'blocked', detail: timersOnly ? 'Verified DNS cache/soak timers have not elapsed' : 'Required stage findings need resolution', findings };
}

export function workflowProgress(domain: string, state: unknown): Progress {
  if (state === 'pending' || state === 'in_progress') return { domain, state: 'waiting', detail: `Registrar workflow ${state}; monitoring without resubmission` };
  if (state === 'succeeded') return { domain, state: 'waiting', detail: 'Workflow succeeded; waiting for active canonical registration and RDAP ownership' };
  return { domain, state: 'blocked', detail: `Registrar workflow ${String(state)}; resolve the existing workflow, never resubmit it` };
}
