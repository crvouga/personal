import type { DoctorCheck } from '../doctor';

function make(
  severity: DoctorCheck['severity'],
  id: string,
  label: string,
  detail: string
): DoctorCheck {
  return { id, label, severity, detail };
}

function withFix(check: DoctorCheck, fix: string | undefined): DoctorCheck {
  return fix === undefined ? check : { ...check, fix };
}

export function passCheck(
  id: string,
  label: string,
  detail: string
): DoctorCheck {
  return make('pass', id, label, detail);
}

export function warnCheck(
  id: string,
  label: string,
  detail: string,
  fix?: string
): DoctorCheck {
  return withFix(make('warn', id, label, detail), fix);
}

export function failCheck(
  id: string,
  label: string,
  detail: string,
  fix?: string
): DoctorCheck {
  return withFix(make('fail', id, label, detail), fix);
}
