/**
 * A presentation: one role's page, fully resolved.
 *
 * It is a pure function of three inputs: the knowledge base (the facts), the
 * market landscape (what that audience asks for) and the role's voice
 * and theme (the hand-written part). Pages and the résumé render a
 * `Presentation` and decide nothing themselves.
 */
import { RESUME_HREF } from '../constants/resume';
import { sectionsFor, type Section, type SectionId } from '../content/sections';
import type { Project } from '../content/project';
import { buildWork, type Work } from '../content/work';
import { visibleProjectsFor, type GalleryItem } from '../lib/projects-view';
import { pageGalleriesFor } from '../lib/work-view';
import {
  ROLE_IDS,
  DEFAULT_ROLE_ID,
  roleById,
  isRoleId,
  type RoleId,
} from './definitions';
import { demandFor, type Demand } from './demand';
import { themeCss } from '../design-system/css';
import { THEMES, type Theme } from './theme';
import { VOICES, type Voice } from './voice';

/**
 * The query parameter shared pages (`/projects/`, case studies) read to take
 * on a presentation's look. Old `/?role=<id>` links redirect to the path.
 */
export const ROLE_PARAM = 'role';
/** Each non-default presentation is a plain static page at `/a/<id>/`. */
export const ROLE_DIR = 'a';

/** The homepage of a presentation: `/` for the default, else `/a/<id>/`. */
export const presentationHome = (id: RoleId): string =>
  id === DEFAULT_ROLE_ID ? '/' : `/${ROLE_DIR}/${id}/`;

/** The role's own page in the index: `/roles/<id>/`. */
export const roleDetailsHref = (id: RoleId): string => `/roles/${id}/`;

export type Presentation = {
  readonly id: RoleId;
  readonly isDefault: boolean;
  readonly audience: string;
  readonly voice: Voice;
  readonly theme: Theme;
  readonly themeCss: string;
  readonly demand: Demand;
  readonly sections: readonly Section[];
  /** Roles in date order; each role's highlights ranked for this audience. */
  readonly work: readonly Work[];
  /** The homepage flagships, ranked for this audience. */
  readonly projects: readonly Project[];
  readonly galleries: readonly (readonly GalleryItem[])[];
  /** Its homepage: `/` for the default, else `/a/<id>/`. */
  readonly home: string;
  /** `''` for the default, else `?role=<id>`; appended to shared-page links. */
  readonly query: string;
  readonly resumeHref: string;
};

const build = (id: RoleId): Presentation => {
  const role = roleById(id);
  const demand = demandFor(role);
  const voice = VOICES[id];
  const theme = THEMES[id];
  const work = buildWork(demand);
  const projects = visibleProjectsFor(demand);
  const isDefault = id === DEFAULT_ROLE_ID;
  const query = isDefault ? '' : `?${ROLE_PARAM}=${id}`;
  return {
    id,
    isDefault,
    audience: role.audience,
    voice,
    theme,
    themeCss: themeCss(theme),
    demand,
    sections: sectionsFor(voice.sections, voice.titles),
    work,
    projects,
    galleries: pageGalleriesFor(projects, work),
    home: presentationHome(id),
    query,
    resumeHref: isDefault
      ? RESUME_HREF
      : `${presentationHome(id).slice(0, -1)}${RESUME_HREF}`,
  };
};

const PRESENTATIONS: ReadonlyMap<RoleId, Presentation> = new Map(
  ROLE_IDS.map((id) => [id, build(id)])
);

export const presentationFor = (id: RoleId): Presentation => {
  const found = PRESENTATIONS.get(id);
  if (found === undefined) throw new Error(`Unknown role: ${id}`);
  return found;
};

export const DEFAULT_PRESENTATION: Presentation =
  presentationFor(DEFAULT_ROLE_ID);

/** Every presentation that gets its own built page: all but the default. */
export const VARIANT_PRESENTATIONS: readonly Presentation[] = [
  ...PRESENTATIONS.values(),
].filter((presentation) => !presentation.isDefault);

/** The presentation for a role id; anything unknown is the default. */
export const resolvePresentation = (value: string | null): Presentation =>
  value !== null && isRoleId(value)
    ? presentationFor(value)
    : DEFAULT_PRESENTATION;

/**
 * The presentation a component renders: its own `role` prop (how
 * Storybook and parent components inject one), else the one the page set on
 * `Astro.locals`, else the default.
 */
export const presentationOf = (astro: {
  readonly locals: App.Locals;
  readonly props: Record<string, unknown>;
}): Presentation => {
  const role = astro.props['role'];
  if (typeof role === 'string') return resolvePresentation(role);
  return astro.locals.presentation ?? DEFAULT_PRESENTATION;
};

export const sectionOf = (
  presentation: Presentation,
  id: SectionId
): Section => {
  const found = presentation.sections.find((section) => section.id === id);
  if (found === undefined) throw new Error(`Unknown section id: ${id}`);
  return found;
};
