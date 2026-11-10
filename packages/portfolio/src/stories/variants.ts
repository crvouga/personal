/**
 * The variants every story is rendered in: each archetype, in each colour
 * scheme its theme can show (an always-light theme has one). A story file
 * spreads these as its named exports, so a new archetype or scheme reaches
 * every story at once; `stories.test.ts` fails a file that misses one.
 */
import {
  ARCHETYPE_IDS,
  DEFAULT_ARCHETYPE_ID,
  type ArchetypeId,
} from '../archetypes/definitions';
import { THEMES } from '../archetypes/theme';

export type Scheme = 'dark' | 'light';

export type Variant = {
  readonly name: string;
  readonly args: { readonly archetype: ArchetypeId };
  readonly parameters: { readonly scheme: Scheme };
};

const SHORT: Readonly<Record<ArchetypeId, string>> = {
  'tech-company-senior-developer': 'Senior',
  'tech-company-staff-engineer': 'Staff',
  'startup-small-company-senior-developer': 'Startup',
  'corporate-large-company-senior-developer': 'Corporate',
  'corporate-contractor-systems-architect': 'Contractor',
};

const schemesOf = (id: ArchetypeId): readonly Scheme[] =>
  THEMES[id].scheme === 'light' ? ['light'] : ['dark', 'light'];

const variant = (id: ArchetypeId, scheme: Scheme): Variant => ({
  name: `${SHORT[id]} · ${scheme}${id === DEFAULT_ARCHETYPE_ID ? ' (default)' : ''}`,
  args: { archetype: id },
  parameters: { scheme },
});

/** Export name → variant, e.g. `SeniorDark`, `Corporate`. */
export const VARIANTS = {
  SeniorDark: variant('tech-company-senior-developer', 'dark'),
  SeniorLight: variant('tech-company-senior-developer', 'light'),
  StaffDark: variant('tech-company-staff-engineer', 'dark'),
  StaffLight: variant('tech-company-staff-engineer', 'light'),
  StartupDark: variant('startup-small-company-senior-developer', 'dark'),
  StartupLight: variant('startup-small-company-senior-developer', 'light'),
  Corporate: variant('corporate-large-company-senior-developer', 'light'),
  Contractor: variant('corporate-contractor-systems-architect', 'light'),
} as const satisfies Record<string, Variant>;

/** Every archetype × scheme a theme can show, for the completeness test. */
export const EXPECTED_VARIANTS: readonly string[] = ARCHETYPE_IDS.flatMap(
  (id) => schemesOf(id).map((scheme) => `${id}/${scheme}`)
);

/** The archetype control: a dropdown of every archetype id. */
export const ARCHETYPE_ARG_TYPES = {
  archetype: { control: 'select', options: ARCHETYPE_IDS },
} as const;
