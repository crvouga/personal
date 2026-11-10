/**
 * Story export names per role, shared by the generator
 * (`codegen.ts`, which reads the file system) and Storybook (which cannot).
 */
/** Whether a theme shows both schemes, or is always light. */
export type SchemeOf = (id: string) => 'auto' | 'light';

/** `SeniorDark`, `SeniorLight`, or just `Corporate` for an always-light theme. */
export const variantNamesFor = (
  specs: readonly { readonly id: string; readonly label: string }[],
  schemeOf: SchemeOf
): string[] =>
  specs.flatMap((spec) =>
    schemeOf(spec.id) === 'light'
      ? [spec.label]
      : [`${spec.label}Dark`, `${spec.label}Light`]
  );
