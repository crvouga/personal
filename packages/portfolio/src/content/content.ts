import {
  ABOUT_ME_PARAGRAPHS,
  ABOUT_YOUTUBE_EMBED_URL,
  ABOUT_YOUTUBE_VIDEO_TITLE,
  ABOUT_GITHUB_HEATMAP_TEXT,
} from './about';
import { CONTACT_COPY } from './contact';
import {
  CORE_STACK,
  HERO,
  LOCATION,
  MONOGRAM_INITIALS,
  NAME,
  ROLE,
} from './hero';
import { ARCHIVE_PROJECTS, PROJECTS } from './project';
import { PROOF_LEDE } from './proof';
import { SCHOOL } from './school';
import { SECTIONS, getSection } from './sections';
import { buildSkillRows } from './skills';
import { WORK } from './work';
import {
  AGENTIC_CURSOR_BADGE,
  AGENTIC_CURSOR_TEXT,
  AGENTIC_WORKFLOW_POINTS,
  AGENTIC_WORKFLOW_TITLE,
} from './agentic';

/** Every technology named by at least one project, bucketed for the Toolbox. */
const SKILL_ROWS = buildSkillRows([
  ...new Set(PROJECTS.flatMap((project) => project.topics)),
]);

export const CONTENT = {
  SITE_URL: 'https://www.chrisvouga.dev',
  SITE_SOURCE_CODE_URL:
    'https://github.com/crvouga/workspace/tree/main/packages/portfolio',
  PAGE_TITLE: NAME,
  PAGE_SUBTITLE: ROLE,
  EMAIL_ADDRESS: 'crvouga@gmail.com',
  GITHUB_URL: 'https://github.com/crvouga',
  LINKEDIN_URL: 'https://www.linkedin.com/in/chris-vouga',
  X_URL: 'https://x.com/ChristopherVou7',
  PHONE_NUMBER: '4802098698',
  LOCATION,
  SECTIONS,
  GET_SECTION: getSection,
  //
  HERO,
  CORE_STACK,
  MONOGRAM_INITIALS,
  CONTACT_COPY,
  //
  PROOF_LEDE,
  PROJECT_SECTION_TITLE: getSection('projects').title,
  PROJECTS,
  ARCHIVE_PROJECTS,
  AGENTIC_CURSOR_BADGE,
  AGENTIC_CURSOR_TEXT,
  AGENTIC_WORKFLOW_TITLE,
  AGENTIC_WORKFLOW_POINTS,
  //
  WORK_SECTION_TITLE: getSection('work').title,
  WORK,
  //
  ABOUT_ME_SECTION_TITLE: getSection('about').title,
  ABOUT_ME_PARAGRAPHS,
  SKILL_ROWS,
  ABOUT_YOUTUBE_EMBED_URL,
  ABOUT_YOUTUBE_VIDEO_TITLE,
  ABOUT_GITHUB_HEATMAP_TEXT,
  //
  SCHOOL,
  //
  CONTACT_SECTION_TITLE: getSection('contact').title,
};
