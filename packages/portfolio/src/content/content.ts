import { IDENTITY } from '../knowledge/identity';
import { ABOUT_ME_PARAGRAPHS } from './about';
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
import { PROOF_ANOMALY_NOTE, PROOF_CALENDAR_NOTE, PROOF_LEDE } from './proof';
import { SCHOOL } from './school';
import { SECTIONS, getSection } from './sections';
import { buildSkillRows } from './skills';
import { WORK, WORK_GAP_NOTE } from './work';
import {
  AGENTIC_CANDOR,
  AGENTIC_CONTRACT,
  AGENTIC_END_TO_END,
  AGENTIC_PRINCIPLES,
  AGENTIC_TOOLING,
  AGENTIC_WORKFLOW_TITLE,
} from './agentic';

/** Every topic, with how many projects and roles use it. */
const TOPIC_USES = (() => {
  const uses = new Map<string, number>();
  const lists = [
    ...PROJECTS.map((project) => project.topics),
    ...WORK.map((work) => work.topics ?? []),
  ];
  for (const topic of lists.flatMap((list) => [...new Set(list)])) {
    uses.set(topic, (uses.get(topic) ?? 0) + 1);
  }
  return uses;
})();

/** Every technology named by at least one project or role. */
const SKILL_ROWS = buildSkillRows([...TOPIC_USES.keys()]);

export const CONTENT = {
  SITE_URL: IDENTITY.siteUrl,
  SITE_SOURCE_CODE_URL: IDENTITY.siteSourceUrl,
  PAGE_TITLE: NAME,
  PAGE_SUBTITLE: ROLE,
  EMAIL_ADDRESS: IDENTITY.email,
  GITHUB_URL: IDENTITY.profiles.github,
  LINKEDIN_URL: IDENTITY.profiles.linkedin,
  X_URL: IDENTITY.profiles.x,
  PHONE_NUMBER: IDENTITY.phone,
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
  PROOF_CALENDAR_NOTE,
  PROOF_ANOMALY_NOTE,
  PROJECT_SECTION_TITLE: getSection('projects').title,
  PROJECTS,
  ARCHIVE_PROJECTS,
  AGENTIC_WORKFLOW_TITLE,
  AGENTIC_PRINCIPLES,
  AGENTIC_CONTRACT,
  AGENTIC_TOOLING,
  AGENTIC_END_TO_END,
  AGENTIC_CANDOR,
  //
  WORK_SECTION_TITLE: getSection('work').title,
  WORK,
  WORK_GAP_NOTE,
  //
  ABOUT_ME_SECTION_TITLE: getSection('about').title,
  ABOUT_ME_PARAGRAPHS,
  SKILL_ROWS,
  //
  SCHOOL,
  //
  CONTACT_SECTION_TITLE: getSection('contact').title,
};
