/**
 * A presentation: one archetype's page, fully resolved.
 *
 * It is a pure function of three inputs: the knowledge base (the facts), the
 * market landscape (what that audience asks for) and the archetype's voice
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
  ARCHETYPE_IDS,
  DEFAULT_ARCHETYPE_ID,
  archetypeById,
  isArchetypeId,
  type ArchetypeId,
} from './definitions';
import { demandFor, type Demand } from './demand';
import { THEMES, themeCss, type Theme } from './theme';
import { VOICES, type Voice } from './voice';

/**
 * The query parameter shared pages (`/projects/`, case studies) read to take
 * on a presentation's look. Old `/?archetype=<id>` links redirect to the path.
 */
export const ARCHETYPE_PARAM = 'archetype';
/** Each non-default presentation is a plain static page at `/a/<id>/`. */
export const ARCHETYPE_DIR = 'a';

/** The homepage of a presentation: `/` for the default, else `/a/<id>/`. */
export const presentationHome = (id: ArchetypeId): string =>
  id === DEFAULT_ARCHETYPE_ID ? '/' : `/${ARCHETYPE_DIR}/${id}/`;

/** The archetype's own page in the index: `/archetypes/<id>/`. */
export const archetypeDetailsHref = (id: ArchetypeId): string =>
  `/archetypes/${id}/`;

export type Presentation = {
  readonly id: ArchetypeId;
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
  /** `''` for the default, else `?archetype=<id>`; appended to shared-page links. */
  readonly query: string;
  readonly resumeHref: string;
};

const build = (id: ArchetypeId): Presentation => {
  const archetype = archetypeById(id);
  const demand = demandFor(archetype);
  const voice = VOICES[id];
  const theme = THEMES[id];
  const work = buildWork(demand);
  const projects = visibleProjectsFor(demand);
  const isDefault = id === DEFAULT_ARCHETYPE_ID;
  const query = isDefault ? '' : `?${ARCHETYPE_PARAM}=${id}`;
  return {
    id,
    isDefault,
    audience: archetype.audience,
    voice,
    theme,
    themeCss: themeCss(id),
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

const PRESENTATIONS: ReadonlyMap<ArchetypeId, Presentation> = new Map(
  ARCHETYPE_IDS.map((id) => [id, build(id)])
);

export const presentationFor = (id: ArchetypeId): Presentation => {
  const found = PRESENTATIONS.get(id);
  if (found === undefined) throw new Error(`Unknown archetype: ${id}`);
  return found;
};

export const DEFAULT_PRESENTATION: Presentation =
  presentationFor(DEFAULT_ARCHETYPE_ID);

/** Every presentation that gets its own built page: all but the default. */
export const VARIANT_PRESENTATIONS: readonly Presentation[] = [
  ...PRESENTATIONS.values(),
].filter((presentation) => !presentation.isDefault);

/** The presentation for an archetype id; anything unknown is the default. */
export const resolvePresentation = (value: string | null): Presentation =>
  value !== null && isArchetypeId(value)
    ? presentationFor(value)
    : DEFAULT_PRESENTATION;

/** The presentation a page set on `Astro.locals`, else the default. */
export const presentationOf = (astro: {
  readonly locals: App.Locals;
}): Presentation => astro.locals.presentation ?? DEFAULT_PRESENTATION;

export const sectionOf = (
  presentation: Presentation,
  id: SectionId
): Section => {
  const found = presentation.sections.find((section) => section.id === id);
  if (found === undefined) throw new Error(`Unknown section id: ${id}`);
  return found;
};
