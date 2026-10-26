import type { CaseStudy } from './types';

/**
 * Source is private, so every claim here is one the repository's README
 * states and the outcome figures come from `src/data/gamezilla-facts.json`.
 */
export const GAMEZILLA_CASE_STUDY: CaseStudy = {
  projectId: 'gamezilla',
  slug: 'gamezilla',
  title: 'gamezilla: a product defined by executable specs',
  subline:
    'The specs, not the code, define the product: a rewrite that passes them is the same app.',
  description:
    'How gamezilla, a local-first multiplayer game app, is defined by executable specifications and formal models that every pull request must pass.',
  problem: [
    'gamezilla is a game app for phones: open it, get a profile at once, host a live space and play with friends watching. It has to work with no connection and catch up on its own when one returns, on low-end Android phones first. Offline play, live rooms, payments and accounts interact in ways that are easy to get subtly wrong, and much of the code is written with AI coding agents.',
  ],
  constraints: [
    'The app works offline; anything that needs other people waits, then catches up.',
    'Two devices, a lost connection or a crash must never count a result twice or lose one.',
    'No manual testing: a release is approved only by automated evidence.',
    'An agent must not be able to change what the product does without changing its definition first.',
  ],
  design: [
    'Durable data lives in a local database on the device. Every write is a mutation applied locally, queued, and replayed on the server in one transaction, which then pushes the change to subscribed devices. Live play runs in rooms with one authoritative event log: the device runs the same rules for instant feedback, and the server validates and orders.',
    'Behavior is defined in a specs directory, separate from the code. A change to what the product does is a spec commit first, and only then the implementation.',
  ],
  correctness: [
    'Every spec is executable. Gherkin features describe what a person observes; Quint models check what can happen over any sequence of choices; Alloy models define which stored states are legal; decision tables answer who may do what; and service objectives set how well it must work. A release with unknown, skipped or manual evidence fails.',
    'Time, timers, ids, randomness and network calls are injected, so tests run on virtual time and replay exactly. New behavior is a property test with a pinned seed, and a random search that finds a failure pins it before it is fixed. Every pull request runs every gate, including release journeys in a real browser against a production-shaped database and message broker with network latency added, so a green pull request is releasable by definition. Third-party vendors are emulated by Mockingbird.',
  ],
  outcome: [
    'The source is private; the figures below are counted from the repository on the date shown.',
  ],
  differently: [
    'The main branch still accepts a direct push, so a commit can skip the pull-request gate and meet only the deploy’s own run of it; the repository’s own briefing says so. I would require a pull request for every change, as my workspace repository does, so the gate cannot be stepped around.',
  ],
  links: [
    { label: 'gamezilla, live', href: 'https://www.gamezilla.app/' },
    {
      label: 'Mockingbird, which emulates its vendors',
      href: 'https://mockingbird.chrisvouga.dev/',
    },
  ],
  hero: {
    src: '/gamezilla.optimized.webp',
    alt: 'gamezilla in two phone-sized windows: one live chess game seen from each player’s side',
    width: 1400,
    height: 788,
  },
};
