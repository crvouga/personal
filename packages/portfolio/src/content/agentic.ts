/**
 * "How I build" — a method, with receipts.
 *
 * Each principle reads the same to a hiring manager and to an engineer and
 * stays true if any one tool is swapped out. Under each one is a link to the
 * artifact that implements it, in a public repository, so the claim can be
 * checked rather than believed. Numbers beside the receipts are rendered from
 * `src/data/platform-facts.json`, never typed here.
 */

export const WORKSPACE_REPO_URL = 'https://github.com/crvouga/workspace';

const blob = (path: string): string =>
  `${WORKSPACE_REPO_URL}/blob/main/${path}`;
const tree = (path: string): string =>
  `${WORKSPACE_REPO_URL}/tree/main/${path}`;
const pull = (n: number): string => `${WORKSPACE_REPO_URL}/pull/${n}`;
const run = (id: number): string => `${WORKSPACE_REPO_URL}/actions/runs/${id}`;
const commit = (sha: string): string => `${WORKSPACE_REPO_URL}/commit/${sha}`;

export type Receipt = {
  readonly label: string;
  readonly href: string;
};

/** Facts from `platform-facts.json` a principle can cite beside its receipts. */
export type PrincipleFact = 'gates' | 'health' | 'tests';

export type Principle = {
  readonly title: string;
  /** Plain text; one or two sentences. */
  readonly body: string;
  readonly receipts: readonly Receipt[];
  readonly fact?: PrincipleFact;
};

export const AGENTIC_WORKFLOW_TITLE = 'Specify first. Verify everything.';

export const AGENTIC_PRINCIPLES: readonly Principle[] = [
  {
    title: 'Start from the spec.',
    body: 'A change starts as written acceptance criteria, so a teammate or an AI coding agent works to a contract rather than a guess.',
    receipts: [
      {
        label: 'Acceptance spec for the shared sign-in service',
        href: blob('packages/auth-relay/acceptance.md'),
      },
      {
        label: 'The pull-request checklist every agent runs',
        href: blob('.agents/commands/pr-ready.md'),
      },
    ],
  },
  {
    title: 'Make verification automatic.',
    body: 'Requirements become checks that run on every change. This site’s résumé fails the build if it spills onto a second page; its share card fails if text is clipped.',
    receipts: [
      {
        label: 'Résumé one-page tests',
        href: blob('packages/portfolio/src/resume/pdf.test.ts'),
      },
      {
        label: 'Share-card overflow tests',
        href: blob('packages/portfolio/src/social/card.test.ts'),
      },
      {
        label: 'Structural size limits on all code',
        href: blob('packages/eslint-rules/size-limits.cjs'),
      },
    ],
    fact: 'tests',
  },
  {
    title: 'Let the pipeline decide.',
    body: 'Nothing merges without passing continuous integration, whoever or whatever wrote it. AI coding agents draft; the pipeline is the gate.',
    receipts: [
      { label: 'The CI workflow', href: blob('.github/workflows/ci.yml') },
      {
        label: 'Required checks, declared as code',
        href: blob('packages/infra/tofu/foundation/repository.tf'),
      },
      {
        label: 'Policy tests that hold agents to the rules',
        href: blob('scripts/iac-policy.test.ts'),
      },
    ],
    fact: 'gates',
  },
  {
    title: 'Own the outcome.',
    body: 'A daily read-only report compares the live platform with what the repository declares, and no plan can destroy a live database or bucket. When something ships wrong, it is mine.',
    receipts: [
      { label: 'Health checks', href: tree('packages/infra/lib/health') },
      {
        label: 'The daily maintenance job',
        href: blob('.github/workflows/maintenance.yml'),
      },
    ],
    fact: 'health',
  },
];

/** The contract, linked on its own line under the principles. */
export const AGENTIC_CONTRACT: Receipt = {
  label:
    'AGENTS.md — the contract every AI coding agent in my repositories works under',
  href: blob('AGENTS.md'),
};

/**
 * Named tools, for the keyword match a screener runs. Only what the commit
 * history shows: the trailer counts beside it come from platform-facts.json.
 */
export const AGENTIC_TOOLING = {
  lead: 'Day to day: Claude Code and Cursor, the co-authors named in this repository’s commit history.',
  harnesses:
    'One canonical command set is synced to every harness the repository supports.',
  harnessesHref: blob('scripts/agent-commands.ts'),
};

export type StoryStep = {
  readonly text: string;
  readonly link?: Receipt;
};

/** One real pull request: an agent drafted, CI rejected, the fix landed. */
export type Story = {
  readonly title: string;
  /** The point in one line: the summary a reader sees before expanding. */
  readonly gist: string;
  readonly steps: readonly StoryStep[];
};

export const AGENTIC_END_TO_END: Story = {
  title: 'A change, end to end',
  gist: 'An agent’s change failed a CI test; the fix added tests; it merged green.',
  steps: [
    {
      text: 'An agent co-authored a change that taught the CI infrastructure step to create the sign-in service’s database schemas before migrating them.',
      link: { label: 'pull request #97', href: pull(97) },
    },
    {
      text: 'CI rejected it: the test that a schema bootstrap may only create empty schemas failed.',
      link: { label: 'the failing run', href: run(39335470324) },
    },
    {
      text: 'The follow-up commit restructured the bootstrap so it could be tested, and added the tests that prove it.',
      link: {
        label: 'fix commit 63c3757',
        href: commit('63c3757bba19f541e2b48a20bc9cd482e7361f18'),
      },
    },
    {
      text: 'It merged only once every required check was green.',
    },
  ],
};

/** When the method failed. Its absence would read as marketing. */
export const AGENTIC_CANDOR: Story = {
  title: 'When it failed',
  gist: 'An agent broke a rule CI enforces, and a skipped check let it merge.',
  steps: [
    {
      text: 'An agent co-authored change added direct cloud-provider calls to a deploy workflow, which breaks this repository’s rule that only declared infrastructure code may touch the cloud.',
      link: { label: 'pull request #100', href: pull(100) },
    },
    {
      text: 'The policy test that forbids it already existed, but a path filter skipped the check for that pull request, so it merged.',
    },
    {
      text: 'The next pull request’s check caught it, and the fix removed the calls.',
      link: {
        label: 'fix commit acc261f',
        href: commit('acc261f410800c6ab04f54b499e7eee377a83fe6'),
      },
    },
    {
      text: 'What changed: the repository-wide check now runs on every pull request, whatever it touches.',
      link: { label: 'pull request #120', href: pull(120) },
    },
  ],
};

export const AGENTIC_CURSOR_BADGE = 'Recognized by Cursor';
export const AGENTIC_CURSOR_TEXT =
  'Cursor named me one of its top Tab users. That measures volume; the checks above are what make volume trustworthy.';

/** Every outbound link in this section, for the daily link check. */
export const AGENTIC_LINKS: readonly string[] = [
  ...AGENTIC_PRINCIPLES.flatMap((p) => p.receipts.map((r) => r.href)),
  AGENTIC_CONTRACT.href,
  AGENTIC_TOOLING.harnessesHref,
  ...[...AGENTIC_END_TO_END.steps, ...AGENTIC_CANDOR.steps].flatMap((s) =>
    s.link === undefined ? [] : [s.link.href]
  ),
];
