/**
 * The roles: the kinds of job this portfolio is presented for, read from
 * the role files (`src/roles/by-id/`, one file each).
 *
 * Each one is a set of segments in the market landscape (hiring context or
 * role family × level), backed by enough postings to measure, whose demand
 * profile differs from the others enough to change what a page leads with.
 *
 * Ids are public: `/a/<id>/` is a presentation's URL, so an id is only
 * renamed or removed deliberately (the `/portfolio-refresh` command), never by
 * a data refresh. `bun run roles:status` reports when the data argues for
 * a different set or a different default.
 */
import { ROLE_DEFINITIONS } from './by-id/index';
import type { RoleSpec, Cell } from './define';

export type { Cell };

export type RoleId = (typeof ROLE_DEFINITIONS)[number]['id'];

export type RoleDefinition = Pick<
  RoleSpec<RoleId>,
  'id' | 'label' | 'audience' | 'description' | 'cells'
>;

export const ROLES: readonly RoleDefinition[] = ROLE_DEFINITIONS;

export const ROLE_IDS: readonly RoleId[] = ROLE_DEFINITIONS.map(
  (role) => role.id
);

/**
 * Served at `/`; every other role is at `/a/<id>/`. The largest
 * segment of the landscape that the knowledge base fits well, at the level
 * currently held; `roles:status` recomputes the argument.
 */
export const DEFAULT_ROLE_ID: RoleId = 'tech-company-senior-developer';

/** What a valid role id looks like; nginx applies the same test. */
export const ROLE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export const isRoleId = (value: string): value is RoleId =>
  (ROLE_IDS as readonly string[]).includes(value);

export const specById = (id: RoleId): RoleSpec<RoleId> => {
  const found = ROLE_DEFINITIONS.find((role) => role.id === id);
  if (found === undefined) throw new Error(`Unknown role: ${id}`);
  return found;
};

export const roleById = (id: RoleId): RoleDefinition => specById(id);
