/**
 * One résumé PDF per non-default archetype, built from the same presentation
 * as its page: the same summary, the same ranking, the same accent. nginx
 * serves it for `/chris-vouga-resume.pdf?archetype=<id>`.
 */
import type { APIRoute } from 'astro';
import {
  VARIANT_PRESENTATIONS,
  type Presentation,
} from '../../../archetypes/presentation';
import { resumeResponse } from '../../../resume/response';

export const getStaticPaths = (): {
  params: { archetype: string };
  props: { presentation: Presentation };
}[] =>
  VARIANT_PRESENTATIONS.map((presentation) => ({
    params: { archetype: presentation.id },
    props: { presentation },
  }));

export const GET: APIRoute = ({ props }) =>
  resumeResponse((props as { presentation: Presentation }).presentation);
