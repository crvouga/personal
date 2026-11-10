/**
 * The committed market landscape, validated once at load. The site build only
 * reads it; `bun run market:refresh` is the only writer.
 */
import raw from '../data/market/landscape.json';
import { LANDSCAPE_VERSION, type Landscape } from './landscape-types';

const parse = (value: unknown): Landscape => {
  const landscape = value as Landscape;
  if (landscape.version !== LANDSCAPE_VERSION) {
    throw new Error(
      `landscape.json is version ${String(landscape.version)}; expected ${String(LANDSCAPE_VERSION)}. Run bun run market:refresh.`
    );
  }
  if (landscape.segments.length === 0) {
    throw new Error('landscape.json has no segments');
  }
  return landscape;
};

export const LANDSCAPE: Landscape = parse(raw);
