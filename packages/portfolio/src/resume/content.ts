/**
 * Resume content, assembled from the same modules that render the site.
 *
 * Nothing here is resume-only copy: the summary is the hero pitch, experience
 * is each role's `highlights`, projects are the homepage's featured side
 * projects, and skills come from the projects the resume actually shows. Edit
 * the site content and the resume follows on the next build.
 */
import { CONTENT } from '../content/content';
import type { Project as PortfolioProject } from '../content/project';
import { buildSkillRows, type SkillRow } from '../content/skills';
import { TOPIC_TO_NAME } from '../content/topic';
import { formatPhoneNumber } from '../library/phone-number';
import { VISIBLE_PROJECTS, projectHref } from '../lib/projects-view';
import { AI_ASSISTED_ROW } from '../content/skills';
import { resumeOutcomeFor } from './outcomes';
import { workDateRange } from '../lib/work-view';
import type {
  Education,
  Experience,
  Identity,
  Project,
  ResumeContent,
} from './html';

/** Topics shown beside a project title. */
const MAX_PROJECT_TOPICS = 6;
/** Items per skill row; ordered by how often the resume's projects use them. */
const MAX_SKILLS_PER_ROW = 10;
/**
 * Real, but table stakes for a senior engineer: listing them spends a line a
 * screener skims past and dilutes the keywords that matter.
 */
const OMITTED_SKILLS: ReadonlySet<string> = new Set([
  'css',
  'html',
  'bootstrap',
]);
const LANGUAGE_TOPICS: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'php',
]);

/** Roughly one printed line: the lead sentence, the part a screener reads. */
const MAX_PROJECT_DESCRIPTION_CHARS = 160;

/** Inline tags the resume template renders; everything else is stripped. */
const KEPT_TAG = /^<\/?(strong|em|code)>$/i;

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Site copy is HTML. The external-link arrow (`↗`) is decoration for the web
 * page; in a PDF it reads as a stray glyph glued to a word.
 */
export const toPlainText = (html: string): string =>
  squash(decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/↗/g, ''));

/** Keeps `<strong>`/`<em>`/`<code>` so the scan-anchors survive into print. */
export const toInlineHtml = (html: string): string =>
  squash(
    html
      .replace(/<[^>]*>/g, (tag) => (KEPT_TAG.test(tag) ? tag : ''))
      .replace(/↗/g, '')
  );

/** A sentence this short is a leftover link label ("Documentation site."). */
const MIN_SENTENCE_WORDS = 4;

/**
 * Splits only on terminal punctuation followed by whitespace, so names like
 * `gamezilla.app` and `OpenTofu` stay inside their sentence.
 */
const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(' ').length >= MIN_SENTENCE_WORDS);

/**
 * Whole sentences only, up to the cap. A clipped sentence with an ellipsis
 * reads as a rendering bug on the one artifact that lands in an inbox.
 */
export const leadSentences = (text: string, maxChars: number): string => {
  let out = '';
  for (const sentence of sentences(text)) {
    const next = out === '' ? sentence : `${out} ${sentence}`;
    if (next.length > maxChars) break;
    out = next;
  }
  return out === '' ? (sentences(text)[0] ?? text) : out;
};

const tidyHost = (url: string): string =>
  url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');

/** `github.com/crvouga/workspace/tree/main/…` → `github.com/crvouga/workspace`. */
const MAX_DISPLAY_PATH_SEGMENTS = 2;
const shortUrl = (url: string): string => {
  const [host = '', ...segments] = tidyHost(url).split('/');
  return [host, ...segments.slice(0, MAX_DISPLAY_PATH_SEGMENTS)].join('/');
};

export const includePhone = (env = process.env): boolean =>
  env['RESUME_INCLUDE_PHONE'] === '1';

const buildIdentity = (): Identity => ({
  name: CONTENT.PAGE_TITLE,
  // The current role's title is the level a screener matches against.
  title: CONTENT.WORK[0]?.jobTitle ?? CONTENT.PAGE_SUBTITLE,
  location: CONTENT.LOCATION,
  email: CONTENT.EMAIL_ADDRESS,
  // The public PDF sits on an indexable URL, so the phone number is opt-in:
  // RESUME_INCLUDE_PHONE=1 bun run build makes the copy for a direct application.
  phone: includePhone() ? formatPhoneNumber(CONTENT.PHONE_NUMBER) : null,
  website: tidyHost(CONTENT.SITE_URL),
  websiteUrl: CONTENT.SITE_URL,
  githubDisplay: tidyHost(CONTENT.GITHUB_URL),
  githubUrl: CONTENT.GITHUB_URL,
  linkedinDisplay: tidyHost(CONTENT.LINKEDIN_URL),
  linkedinUrl: CONTENT.LINKEDIN_URL,
});

const buildExperience = (): Experience[] =>
  CONTENT.WORK.map((work) => ({
    company: work.name,
    jobTitle: work.jobTitle,
    dateRange: workDateRange(work),
    bullets: work.highlights.map(toInlineHtml),
    awards: (work.awards ?? []).map(toPlainText),
    url: work.infoUrl ?? null,
  }));

/**
 * The homepage's featured side projects, in homepage order. Work projects are
 * already told inside Experience, so listing them again only repeats a bullet.
 */
export const resumeProjects = (): readonly PortfolioProject[] =>
  VISIBLE_PROJECTS.filter(
    (project) =>
      project.setting === 'side' &&
      project.resume?.include !== false &&
      projectHref(project) !== null
  );

const buildProjects = (): Project[] =>
  resumeProjects().map((project) => {
    const url = projectHref(project);
    return {
      title: project.title,
      // A measured one-line outcome where the snapshots have one; otherwise
      // the card's own description.
      description:
        resumeOutcomeFor(project.id) ??
        leadSentences(
          toPlainText(project.description),
          MAX_PROJECT_DESCRIPTION_CHARS
        ),
      url,
      urlDisplay: url === null ? null : shortUrl(url),
      topics: project.topics
        .slice(0, MAX_PROJECT_TOPICS)
        .map((topic) => TOPIC_TO_NAME[topic]),
    };
  });

/**
 * Skills are the technologies behind what the resume claims: every work
 * project plus the listed side projects. Ranked by use so the stack a screener
 * should see first is first, not alphabetised into the middle of a row.
 */
export const buildSkills = (): SkillRow[] => {
  const shown = [
    ...CONTENT.PROJECTS.filter((project) => project.setting === 'work'),
    ...resumeProjects(),
  ];
  const uses = new Map<string, number>();
  // Languages come from every listed project: a language is a skill whether
  // or not its project made the one-page cut.
  const languages = CONTENT.PROJECTS.flatMap(
    (project) => project.topics
  ).filter((topic) => LANGUAGE_TOPICS.has(topic));
  const topics = [
    ...shown.flatMap((project) => project.topics),
    ...CONTENT.WORK.flatMap((work) => work.topics ?? []),
    ...languages,
  ].filter((topic) => !OMITTED_SKILLS.has(topic));
  for (const topic of topics) {
    uses.set(topic, (uses.get(topic) ?? 0) + 1);
  }
  const rankByName = new Map<string, number>(
    [...uses].map(([topic, count]) => [
      TOPIC_TO_NAME[topic as keyof typeof TOPIC_TO_NAME] ?? topic,
      count,
    ])
  );
  const ranked = buildSkillRows([...uses.keys()]).map((row) => ({
    category: row.category,
    items: [...row.items]
      .sort((a, b) => (rankByName.get(b) ?? 0) - (rankByName.get(a) ?? 0))
      .slice(0, MAX_SKILLS_PER_ROW),
  }));
  return [AI_ASSISTED_ROW, ...ranked];
};

const buildEducation = (): Education[] =>
  CONTENT.SCHOOL.map((school) => ({
    degree: school.degree,
    institution: school.institutionName,
    dateRange: `${school.yearStart} – ${school.yearEnd}`,
  }));

export const buildResumeContent = (): ResumeContent => ({
  identity: buildIdentity(),
  summary: [CONTENT.HERO.statement, CONTENT.HERO.statementSecondary].map(
    toPlainText
  ),
  experience: buildExperience(),
  projects: buildProjects(),
  skills: buildSkills(),
  education: buildEducation(),
});
