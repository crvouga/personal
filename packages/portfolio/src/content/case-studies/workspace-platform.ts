import type { CaseStudy } from './types';

const REPO = 'https://github.com/crvouga/workspace';
const blob = (path: string): string => `${REPO}/blob/main/${path}`;

export const WORKSPACE_CASE_STUDY: CaseStudy = {
  projectId: 'workspace-platform',
  slug: 'workspace-platform',
  title: 'Workspace platform: infrastructure only code can change',
  subline:
    'An AI coding agent cannot change production outside reviewed code: policy tests, deletion guards and a daily drift report hold the line.',
  description:
    'A monorepo platform where OpenTofu is the only way to change infrastructure, a daily report checks it, and AI coding agents work under enforced rules.',
  problem: [
    'The services behind this site and my side projects were first created by hand in provider dashboards. Nothing recorded what was supposed to exist, so drift surfaced when something broke. Once AI coding agents were doing most of the typing, an agent holding a credential could change production with no review at all.',
  ],
  constraints: [
    'Infrastructure changes only through declared code: no dashboard edits, no provisioning scripts, no provider calls from workflows.',
    'Live databases, buckets, tunnels and the secrets store must survive any plan, including a wrong one.',
    'Secrets never sit in the repository, in state files or in logs.',
    'The rules have to be enforced by machines, because agents do not remember them.',
    'Physical machines I own are defined by their operating-system configuration, not by cloud tooling.',
  ],
  design: [
    'OpenTofu is the only provisioning tool. One inventory file declares every hosted service, and separate roots own state, the foundation, the bootstrap, the secrets store, sign-in and the runner fleet. State and plans are encrypted, and a change is applied only from a reviewed, saved plan. Existing resources were adopted by import, never replaced, and each root was verified with a plan that changed nothing.',
    'OpenBao holds secrets, and applications read them at run time. Services are container images built in CI and deployed to Railway, and Cloudflare tunnels put access control in front of the internal ones. The CI runners, web servers, binary cache and network installer are NixOS configurations built from one pinned flake.',
  ],
  correctness: [
    'Policy tests fail any change that adds a provisioning path outside OpenTofu, including cloud API clients in workflow files. Every root is formatted, initialized, validated and tested on each pull request, and live resources carry guards that stop even an approved plan from deleting them.',
    'A daily read-only report compares the live platform with the inventory — DNS, TLS, services, tunnels, secrets, storage, images and runners — and plans every root to catch drift. A missing credential reports as skipped, never as a pass, and each failure comes with a guided fix that goes through OpenTofu or CI, never a provider dashboard.',
    'The rules agents work under are written down in AGENTS.md, and one command set is synced to every agent harness the repository supports.',
  ],
  outcome: [
    'The figures below are counted from the repository and its pull-request history by scripts that run in CI, so they move as the platform does.',
  ],
  differently: [
    'The policy test that forbids provider calls existed before an agent broke that rule, but a path filter skipped the check for that pull request. The full check now runs on every pull request; I would start that way.',
    'The main-branch pipeline also deploys, so its pass rate mixes deploy trouble with code that failed review. I would report the two separately, so the number on the merge gate means one thing.',
  ],
  links: [
    { label: 'Workspace source on GitHub', href: REPO },
    {
      label: 'AGENTS.md, the rules agents work under',
      href: blob('AGENTS.md'),
    },
    {
      label: 'Infrastructure ownership and adoption',
      href: blob('packages/infra/tofu/README.md'),
    },
    {
      label: 'Health checks',
      href: `${REPO}/tree/main/packages/infra/lib/health`,
    },
    { label: 'Policy tests', href: blob('scripts/iac-policy.test.ts') },
  ],
  hero: {
    src: '/workspace-platform-diagram.svg',
    alt: 'Workspace platform architecture: the repository and its CI gates feed declared infrastructure, which runs the hosted services and machines; a daily health report checks them against the repository',
    width: 1200,
    height: 640,
  },
};
