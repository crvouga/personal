/**
 * One résumé PDF per non-default role, built from the same presentation
 * as its page: the same summary, the same ranking, the same accent. Served
 * at `/a/<id>/chris-vouga-resume.pdf`.
 */
import type { APIRoute } from 'astro';
import {
  VARIANT_PRESENTATIONS,
  type Presentation,
} from '../../../roles/presentation';
import { resumeResponse } from '../../../resume/response';

export const getStaticPaths = (): {
  params: { role: string };
  props: { presentation: Presentation };
}[] =>
  VARIANT_PRESENTATIONS.map((presentation) => ({
    params: { role: presentation.id },
    props: { presentation },
  }));

export const GET: APIRoute = ({ props }) =>
  resumeResponse((props as { presentation: Presentation }).presentation);
