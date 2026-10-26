import type { CaseStudy } from './types';

const REPO = 'https://github.com/crvouga/mockingbird';

export const MOCKINGBIRD_CASE_STUDY: CaseStudy = {
  projectId: 'mockingbird',
  slug: 'mockingbird',
  title: 'Mockingbird: emulating vendor APIs faithfully',
  subline:
    'Randomized walks check every emulator against the vendor’s own contract, so a passing test means something.',
  description:
    'How Mockingbird keeps stateful emulators of third-party APIs honest: contract-driven random walks, self-parity in CI, and live parity against vendor sandboxes.',
  problem: [
    'Software that takes payments, sends email or stores files through third-party services is hard to test end to end. Real sandboxes are slow, rate-limited and need credentials that CI should not hold. Hand-written stubs are fast, but they drift from the real API, so tests pass against behavior that does not exist.',
  ],
  constraints: [
    'A test that passes against an emulator has to mean what a test against the vendor means.',
    'It must run in CI with no credentials and no network.',
    'Parallel tests must not see each other’s state, and a failing run must replay exactly.',
    'It has to scale across many vendors without a hand-written stub per endpoint.',
  ],
  design: [
    'Each service is its own npm package with a small command-line server, built on one shared runtime. Every service vendors the provider’s OpenAPI contract and keeps real state: create a customer, list customers, and it is there.',
    'A control plane under /__admin resets state, takes and restores snapshots, moves a virtual clock, injects faults and latency, and keeps a journal of every request. A namespace header isolates parallel tests, and a seeded mode makes a run deterministic. A fleet package starts several emulators at once.',
  ],
  correctness: [
    'The parity runner uses fast-check to generate random, stateful sequences of API calls from each contract. In CI, with no credentials, two independent emulator instances must agree after every call, and every response must conform to the contract. With sandbox keys, the same walk runs against the vendor’s sandbox and a fresh emulator, and responses are compared once volatile ids, timestamps and tokens are stripped. A failure shrinks to the smallest sequence that still fails and prints a seed that replays it.',
    'Around the walks, each service has acceptance tests, and drop-in tests point the vendor’s official SDK at the emulator, so a client that works against Mockingbird works against the vendor. The database emulators compare query behavior with real SQLite and PostgreSQL.',
  ],
  outcome: [
    'The figures below are read from Mockingbird’s published catalog and its repository by the same script that refreshes this site’s proof section.',
  ],
  differently: [
    'Live parity is opt-in per service, and today every service is set to run it only by hand, so the weekly scheduled live run has nothing to check and still reports success. The one daily sandbox check is failing because the vendor’s sandbox now answers “payment required”. A scheduled run with nothing to test should fail, not pass, and live parity should rotate through services on a budget.',
    'Some emulators are still marked work in progress. I would rather publish fewer services, each complete, than a long list a reader has to second-guess.',
  ],
  links: [
    { label: 'Mockingbird source on GitHub', href: REPO },
    {
      label: 'Mockingbird documentation',
      href: 'https://mockingbird.chrisvouga.dev/',
    },
    {
      label: 'Testing and parity guide',
      href: `${REPO}/blob/main/docs/TESTING.md`,
    },
    {
      label: 'Parity runner',
      href: `${REPO}/tree/main/packages/parity/runner`,
    },
    {
      label: 'Service catalog, with each npm package',
      href: 'https://mockingbird.chrisvouga.dev/services',
    },
  ],
  hero: {
    src: '/mockingbird-screenshot.optimized.webp',
    alt: 'Mockingbird documentation site: an install command and a request to the Stripe emulator',
    width: 1400,
    height: 788,
  },
};
