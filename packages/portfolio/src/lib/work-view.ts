import { CONTENT } from '../content/content';
import type { Work, YearMonth } from '../content/work';
import {
  VISIBLE_GALLERIES,
  toGalleryItems,
  type GalleryItem,
} from './projects-view';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `Mar 2022` when the month is known, else `2022`. */
const endpoint = (point: YearMonth | 'Present'): string => {
  if (point === 'Present') return 'Present';
  const name = point.month === undefined ? undefined : MONTHS[point.month - 1];
  return name === undefined ? String(point.year) : `${name} ${point.year}`;
};

/**
 * Month precision when `work.ts` declares it. A year-only range is rendered as
 * exactly that, never padded with a guessed month.
 */
export const workDateRange = (job: Work): string =>
  `${endpoint(job.start)} – ${endpoint(job.end)}`;

/** `2026-01` / `2022`, the ISO 8601 form JSON Resume and JSON-LD accept. */
export const isoYearMonth = (point: YearMonth): string =>
  point.month === undefined
    ? String(point.year)
    : `${point.year}-${String(point.month).padStart(2, '0')}`;

/** Award images alone are invisible; the text line is the crawlable claim. */
export const workGalleryFor = (job: Work): GalleryItem[] =>
  toGalleryItems(
    [...job.imageSrc, ...job.galleryImageSrc],
    job.name,
    job.imageAlt
  );

export const WORK_GALLERIES: readonly (readonly GalleryItem[])[] =
  CONTENT.WORK.map(workGalleryFor);

/**
 * The gallery dialog indexes one flat array, so work galleries sit after the
 * project ones and carry this offset.
 */
export const WORK_GALLERY_OFFSET = VISIBLE_GALLERIES.length;

/** Every gallery reachable from the homepage, in `data-gallery` index order. */
export const PAGE_GALLERIES: readonly (readonly GalleryItem[])[] = [
  ...VISIBLE_GALLERIES,
  ...WORK_GALLERIES,
];
