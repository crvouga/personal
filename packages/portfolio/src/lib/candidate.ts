/**
 * The candidate, in machine-readable form: JSON Resume, the recruiter-facing
 * `/llms.txt`, and the GitHub profile README. All three are derived from the
 * same registry the page renders — the summary is always `HERO.statement` —
 * so a screening agent, a reviewer reading GitHub and a reader of the site
 * get one story with one set of titles and dates.
 */
import { caseStudyFor, caseStudyHref } from '../content/case-studies';
import { CONTENT } from '../content/content';
import { logisticsLines } from '../content/hero';
import { AGENTIC_CONTRACT } from '../content/agentic';
import type { Work } from '../content/work';
import { RESUME_HREF, RESUME_JSON_PATH } from '../constants/resume';
import { resumeOutcomeFor } from '../resume/outcomes';
import { buildSkills } from '../resume/content';
import { PROOF_TILES } from './proof-view';
import { projectHref, VISIBLE_PROJECTS } from './projects-view';
import { isoYearMonth, workDateRange } from './work-view';

const SITE = CONTENT.SITE_URL;
const abs = (path: string): string =>
  path.startsWith('http') ? path : `${SITE}${path}`;

export const plain = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** One line per flagship: title, where to read about it, its outcome. */
export type Flagship = {
  readonly title: string;
  readonly url: string;
  readonly caseStudyUrl: string | null;
  readonly codeUrl: string | null;
  readonly outcome: string;
};

export const FLAGSHIPS: readonly Flagship[] = VISIBLE_PROJECTS.map(
  (project) => {
    const study = caseStudyFor(project.id);
    return {
      title: project.title,
      url: projectHref(project) ?? abs(`/projects/`),
      caseStudyUrl: study === undefined ? null : abs(caseStudyHref(study)),
      codeUrl: project.code.t === 'public' ? project.code.url : null,
      outcome: resumeOutcomeFor(project.id) ?? project.description,
    };
  }
);

/** The summary everywhere: the hero statement, then its scope line. */
export const CANDIDATE_SUMMARY = `${CONTENT.HERO.statement} ${CONTENT.HERO.statementSecondary}`;

const workEntry = (work: Work): Record<string, unknown> => ({
  name: work.name,
  position: work.jobTitle,
  ...(work.infoUrl === undefined ? {} : { url: work.infoUrl }),
  startDate: isoYearMonth(work.start),
  ...(work.end === 'Present' ? {} : { endDate: isoYearMonth(work.end) }),
  highlights: work.highlights.map(plain),
});

const educationEntries = (): Record<string, unknown>[] =>
  CONTENT.SCHOOL.map((school) => {
    const [studyType = school.degree, area = ''] = school.degree.split(' in ');
    return {
      institution: school.institutionName,
      ...(school.infoUrl === undefined ? {} : { url: school.infoUrl }),
      studyType,
      area,
      startDate: String(school.yearStart),
      endDate: String(school.yearEnd),
    };
  });

const profiles = (): Record<string, string>[] => [
  { network: 'GitHub', username: 'crvouga', url: CONTENT.GITHUB_URL },
  {
    network: 'LinkedIn',
    username:
      new URL(CONTENT.LINKEDIN_URL).pathname.split('/').filter(Boolean).pop() ??
      '',
    url: CONTENT.LINKEDIN_URL,
  },
];

/** https://jsonresume.org/schema — validated by candidate.test.ts. */
export const buildResumeJson = (
  builtAt: Date = new Date()
): Record<string, unknown> => ({
  $schema:
    'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
  basics: {
    name: CONTENT.PAGE_TITLE,
    label: CONTENT.PAGE_SUBTITLE,
    email: CONTENT.EMAIL_ADDRESS,
    url: SITE,
    summary: CANDIDATE_SUMMARY,
    location: { city: 'Phoenix', region: 'AZ', countryCode: 'US' },
    profiles: profiles(),
  },
  work: CONTENT.WORK.map(workEntry),
  education: educationEntries(),
  awards: CONTENT.WORK.flatMap((work) =>
    (work.awards ?? []).map((award) => ({ title: award, awarder: work.name }))
  ),
  skills: buildSkills().map((row) => ({
    name: row.category,
    keywords: [...row.items],
  })),
  projects: FLAGSHIPS.map((f) => ({
    name: f.title,
    description: f.outcome,
    url: f.caseStudyUrl ?? f.url,
  })),
  meta: {
    canonical: abs(RESUME_JSON_PATH),
    version: 'v1.0.0',
    lastModified: builtAt.toISOString().slice(0, 19),
  },
});

const workLines = (): string[] =>
  CONTENT.WORK.flatMap((work) => [
    `### ${work.jobTitle} · ${work.name} · ${workDateRange(work)}`,
    '',
    ...work.highlights.map((h) => `- ${plain(h)}`),
    ...(work.awards ?? []).map((award) => `- Recognition: ${award}`),
    '',
  ]);

const flagshipLine = (f: Flagship): string => {
  const links = [
    f.caseStudyUrl === null ? null : `[case study](${f.caseStudyUrl})`,
    f.codeUrl === null ? null : `[code](${f.codeUrl})`,
  ].filter((link): link is string => link !== null);
  return `- **${f.title}** (${links.join(', ') || f.url}): ${f.outcome}`;
};

/** The recruiter-facing `/llms.txt` (https://llmstxt.org). */
export const buildLlmsTxt = (): string =>
  [
    `# ${CONTENT.PAGE_TITLE}`,
    '',
    `> ${CONTENT.HERO.statement}`,
    '',
    CONTENT.HERO.statementSecondary,
    '',
    `- Role: ${CONTENT.PAGE_SUBTITLE}`,
    `- Availability: ${CONTENT.HERO.availability}`,
    `- Location: ${[CONTENT.HERO.location, ...logisticsLines()].join(' · ')}`,
    `- Contact: ${CONTENT.EMAIL_ADDRESS}`,
    '',
    '## Experience',
    '',
    ...workLines(),
    '## Flagship projects',
    '',
    ...FLAGSHIPS.map(flagshipLine),
    '',
    '## Verification evidence',
    '',
    ...PROOF_TILES.map((t) => `- ${t.value} ${t.label} (${t.detail})`),
    `- How agents are constrained: ${AGENTIC_CONTRACT.href}`,
    '',
    '## Machine-readable',
    '',
    `- [Résumé PDF](${abs(RESUME_HREF)})`,
    `- [JSON Resume](${abs(RESUME_JSON_PATH)})`,
    `- [All projects](${abs('/projects/')})`,
    `- [GitHub](${CONTENT.GITHUB_URL}) · [LinkedIn](${CONTENT.LINKEDIN_URL})`,
    '',
    '## Optional',
    '',
    `- [Infrastructure integration guide](${abs('/llms-infra.txt')}): for AI coding agents working in Chris's own repositories, not candidate information.`,
    '',
  ].join('\n');

/** `generated/github-profile-README.md`, for the `crvouga/crvouga` repository. */
export const buildProfileReadme = (): string =>
  [
    `<!-- Generated by packages/portfolio (bun run gen:profile-readme) from the site's content registry. Edit the registry, not this file. -->`,
    '',
    `# ${CONTENT.PAGE_TITLE}`,
    '',
    `**${CONTENT.HERO.statement}**`,
    '',
    CONTENT.HERO.statementSecondary,
    '',
    '## Flagships',
    '',
    ...FLAGSHIPS.map(flagshipLine),
    '',
    '## How I build',
    '',
    ...CONTENT.AGENTIC_PRINCIPLES.map(
      (p) =>
        `- **${p.title}** ${p.receipts.map((r) => `[${r.label}](${r.href})`).join(' · ')}`
    ),
    `- [${AGENTIC_CONTRACT.label}](${AGENTIC_CONTRACT.href})`,
    '',
    '## Contact',
    '',
    `${CONTENT.HERO.availability} · ${CONTENT.HERO.location}`,
    '',
    `[${CONTENT.EMAIL_ADDRESS}](mailto:${CONTENT.EMAIL_ADDRESS}) · [Website](${SITE}) · [Résumé](${abs(RESUME_HREF)}) · [LinkedIn](${CONTENT.LINKEDIN_URL})`,
    '',
  ].join('\n');

/**
 * `CONSISTENCY_CHECKLIST.md`: the exact strings LinkedIn (and anything else
 * outside this repository) must mirror, so a reviewer who opens the site, the
 * résumé, GitHub and LinkedIn reads one story.
 */
export const buildConsistencyChecklist = (): string =>
  [
    '<!-- Generated by `bun run gen:profile-readme` from the content registry. Edit the registry, not this file. -->',
    '',
    '# Consistency checklist',
    '',
    'The site, the résumé PDF, `/resume.json`, `/llms.txt`, the JSON-LD and the GitHub profile README are generated from one registry and tested to agree. LinkedIn is the one surface this repository cannot write: copy these strings into it verbatim, and re-copy whenever this file changes.',
    '',
    '## LinkedIn headline',
    '',
    `${CONTENT.PAGE_SUBTITLE} · ${CONTENT.HERO.statement}`,
    '',
    '## About',
    '',
    CANDIDATE_SUMMARY,
    '',
    '## Experience (titles and dates exactly)',
    '',
    ...CONTENT.WORK.flatMap((work) => [
      `- **${work.jobTitle}**, ${work.name}, ${workDateRange(work)}`,
      ...work.highlights.map((h) => `  - ${plain(h)}`),
    ]),
    '',
    '## Featured (in this order)',
    '',
    ...FLAGSHIPS.map(
      (f) => `- ${f.title}: ${f.caseStudyUrl ?? f.codeUrl ?? f.url}`
    ),
    '',
    '## Skills (pin the first row)',
    '',
    ...buildSkills().map((row) => `- ${row.category}: ${row.items.join(', ')}`),
    '',
    '## Open to work',
    '',
    `- ${CONTENT.HERO.availability}; ${[CONTENT.HERO.location, ...logisticsLines()].join('; ')}`,
    '- Titles: Senior Software Engineer, Staff Software Engineer',
    '',
  ].join('\n');
