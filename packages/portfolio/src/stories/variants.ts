/**
 * The variants every story is rendered in: each role, in each colour
 * scheme its theme can show (an always-light theme has one). A story file
 * spreads these as its named exports inside a generated block
 * (`bun run roles:sync`), so a new role or scheme reaches every
 * story at once; `codegen.test.ts` fails a file that misses one.
 */
import { ROLE_DEFINITIONS } from '../roles/by-id/index';
import { ROLE_IDS, DEFAULT_ROLE_ID, type RoleId } from '../roles/definitions';
import { variantNamesFor } from '../roles/codegen-names';
import { THEMES } from '../roles/theme';

export type Scheme = 'dark' | 'light';

export type Variant = {
  readonly name: string;
  readonly args: { readonly role: RoleId };
  readonly parameters: { readonly scheme: Scheme };
};

const schemeOf = (id: string): 'auto' | 'light' => THEMES[id as RoleId].scheme;

/** Export name → variant, e.g. `SeniorDark`, `Corporate`. */
export const VARIANTS: Readonly<Record<string, Variant>> = Object.fromEntries(
  ROLE_DEFINITIONS.flatMap((spec) => {
    const schemes: readonly Scheme[] =
      schemeOf(spec.id) === 'light' ? ['light'] : ['dark', 'light'];
    const names = variantNamesFor([spec], schemeOf);
    return schemes.map((scheme, index) => [
      names[index] ?? spec.label,
      {
        name: `${spec.label} · ${scheme}${spec.id === DEFAULT_ROLE_ID ? ' (default)' : ''}`,
        args: { role: spec.id },
        parameters: { scheme },
      } satisfies Variant,
    ]);
  })
);

/** One variant by export name; a story file's generated block calls this. */
export const variant = (name: string): Variant => {
  const found = VARIANTS[name];
  if (found === undefined) {
    throw new Error(`No story variant ${name}: run bun run roles:sync`);
  }
  return found;
};

/** Every export name, in role order: what each story file must export. */
export const VARIANT_NAMES: readonly string[] = Object.keys(VARIANTS);

/** The role control: a dropdown of every role id. */
export const ROLE_ARG_TYPES = {
  role: { control: 'select', options: ROLE_IDS },
} as const;
