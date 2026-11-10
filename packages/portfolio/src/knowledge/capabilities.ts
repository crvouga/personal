/**
 * Which of the skills the market asks for the knowledge base can back.
 *
 * Most are evidenced by a stack: a project or role names the technology.
 * The rest are claimed here, each with the fact that backs it. A skill that
 * is neither is a gap: the landscape reports it and no presentation shows it.
 */
import { SKILLS } from '../roles/skills';
import { PROJECT_FACTS } from './projects';
import { JOBS } from './jobs';
import type { Capability } from './types';

export const CAPABILITIES: readonly Capability[] = [
  {
    skill: 'ai-tools',
    evidence:
      'Claude Code and Cursor are the co-authors in the workspace commit history',
  },
  { skill: 'llm-apis', evidence: 'project llm-proxy routes model requests' },
  {
    skill: 'oauth',
    evidence:
      'achievement orchard-lms-integration (single sign-on); the workspace auth-relay OIDC broker',
  },
  {
    skill: 'stripe',
    evidence:
      'project mockingbird emulates the Stripe API; achievement study-hall-payments',
  },
  { skill: 'accessibility', evidence: 'project headless-combobox' },
  { skill: 'git', evidence: 'every public repository' },
  {
    skill: 'ci-cd',
    evidence: 'project workspace-platform: required CI gates and deploys',
  },
  {
    skill: 'rest',
    evidence: 'project mockingbird emulates third-party HTTP APIs',
  },
  {
    skill: 'observability',
    evidence:
      'the workspace logger observability contract and daily health report',
  },
];

/** Every technology a role, an achievement or a listed project names. */
export const KNOWN_TOPICS: ReadonlySet<string> = new Set([
  ...PROJECT_FACTS.flatMap((project) => project.topics),
  ...JOBS.flatMap((job) => [
    ...(job.topics ?? []),
    ...job.achievements.flatMap((achievement) => achievement.topics),
  ]),
]);

/** Ids of the market skills the knowledge base holds evidence for. */
export const CAPABLE_SKILLS: ReadonlySet<string> = new Set([
  ...SKILLS.filter((skill) =>
    skill.topics.some((topic) => KNOWN_TOPICS.has(topic))
  ).map((skill) => skill.id),
  ...CAPABILITIES.map((capability) => capability.skill),
]);
