import { EDUCATION } from '../knowledge/education';

export type School = {
  infoUrl?: string;
  institutionName: string;
  degree: string;
  yearStart: number;
  yearEnd: number | 'Present';
  imageSrc: string;
  imageAlt: string;
  galleryImageSrc: string[];
};

/** The degrees in `src/knowledge/education.ts`, with the site's diploma image. */
export const SCHOOL: School[] = EDUCATION.map((degree) => ({
  degree: degree.degree,
  institutionName: degree.institution,
  yearEnd: degree.yearEnd,
  yearStart: degree.yearStart,
  ...(degree.institutionUrl === undefined
    ? {}
    : { infoUrl: degree.institutionUrl }),
  imageSrc: '/diploma.optimized.webp',
  imageAlt: 'Diploma',
  galleryImageSrc: ['/diploma.optimized.webp'],
}));
