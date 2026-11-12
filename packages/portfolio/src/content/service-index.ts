/**
 * The `/index/` catalog: a name, one sentence and a group for every host and
 * store the inventory declares. Status, hosting, source and art are read from
 * the inventory or probed at build time.
 *
 * Keys are hostnames, or a store's key from the snapshot (`postgres:<id>`,
 * `blob:<id>`). Entries with the same group and title are one item on the
 * page, and each entry's `variant` names its link (Rust, Dev, Production…).
 * The item's description is the first non-null one, in catalog order.
 *
 * `src/data/service-index.test.ts` holds this file to the snapshot in both
 * directions, so a new host without an entry fails, and so does an entry for
 * a host that is gone.
 *
 * Leave `description` null rather than guess: the item then shows the page's
 * own meta description, or what its status says.
 */

export const CATEGORIES = [
  'public-app',
  'public-api',
  'internal-dashboard',
  'internal-api',
  'postgres',
  'blob',
  'domain',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  'public-app': 'Public Apps',
  'public-api': 'Public APIs',
  'internal-dashboard': 'Internal Dashboards',
  'internal-api': 'Internal APIs',
  postgres: 'Postgres Databases',
  blob: 'S3 Blob Storage',
  domain: 'Domains',
};

export type CatalogEntry = {
  readonly title: string;
  readonly description: string | null;
  readonly category: Category;
  /** Names this link among the item's others; null for a single-link item. */
  readonly variant: string | null;
};

const entry = (
  title: string,
  category: Category,
  description: string | null,
  variant: string | null = null
): CatalogEntry => ({ title, category, description, variant });

export const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  // Public apps
  'www.chrisvouga.dev': entry(
    'Portfolio',
    'public-app',
    'Projects, work history, writing and a generated résumé.'
  ),
  'anime.chrisvouga.dev': entry(
    'Anime Blog',
    'public-app',
    'A blog built as a fast static site, with content managed apart from the code.'
  ),
  'moviefinder.chrisvouga.dev': entry(
    'moviefinder',
    'public-app',
    'Movie and TV discovery with shared lists and reactive social features, built in several stacks side by side.',
    'Main'
  ),
  'moviefinder.app': entry(
    'moviefinder',
    'public-app',
    null,
    'moviefinder.app'
  ),
  'moviefinder-app-rust.chrisvouga.dev': entry(
    'moviefinder',
    'public-app',
    null,
    'Rust'
  ),
  'moviefinder-app-react.chrisvouga.dev': entry(
    'moviefinder',
    'public-app',
    null,
    'React'
  ),
  'moviefinder-app-clojurescript.chrisvouga.dev': entry(
    'moviefinder',
    'public-app',
    null,
    'ClojureScript'
  ),
  'pickflix.chrisvouga.dev': entry(
    'Pickflix',
    'public-app',
    'Watch trailers, write reviews and build shared movie lists with friends.'
  ),
  'todo.chrisvouga.dev': entry(
    'Todo',
    'public-app',
    'A task manager with user accounts and real-time sync.'
  ),
  'gamezilla.app': entry(
    'Gamezilla',
    'public-app',
    'A local-first multiplayer game platform for phones.'
  ),
  'normalizer.app': entry(
    'Normalizer',
    'public-app',
    'Reshapes spreadsheet data from one format into another.'
  ),
  'connectfour.chrisvouga.dev': entry(
    'Connect Four',
    'public-app',
    'Connect Four with online multiplayer and a computer opponent.'
  ),
  'matchthree.chrisvouga.dev': entry(
    'Match Three',
    'public-app',
    'Swipe items around to line up three in a row.'
  ),
  'simonsays.chrisvouga.dev': entry(
    'Simon Says',
    'public-app',
    'The classic memory game, with sound, visuals and rising difficulty.'
  ),
  'snake.chrisvouga.dev': entry(
    'Snake',
    'public-app',
    'The classic Snake game, with smooth animation and responsive controls.'
  ),
  'violetsgarden.chrisvouga.dev': entry(
    "Violet's Garden",
    'public-app',
    'A cozy puzzle game about guiding a pug through garden mazes, every level proven solvable.'
  ),
  'mockingbird.chrisvouga.dev': entry(
    'Mockingbird',
    'public-app',
    'Docs for stateful emulators of third-party APIs and SQL databases, for end-to-end tests.'
  ),
  'mockingbird-fleet.chrisvouga.dev': entry(
    'Mockingbird Fleet',
    'public-app',
    'Hosted fleets of Mockingbird API emulators at stable URLs for staging and CI.'
  ),
  'lanes.chrisvouga.dev': entry(
    'Lanes',
    'public-app',
    'A keyboard-first Git graph for GitHub repositories that updates in real time.'
  ),
  'gitty-storybook.chrisvouga.dev': entry(
    'Lanes Storybook',
    'public-app',
    'The component Storybook for Lanes, a keyboard-first Git graph for GitHub repositories.'
  ),
  'headlesscombobox.chrisvouga.dev': entry(
    'headless-combobox',
    'public-app',
    'Docs and examples for an accessible, framework-agnostic autocomplete component.',
    'Docs'
  ),
  'svelte-headlesscombobox.chrisvouga.dev': entry(
    'headless-combobox',
    'public-app',
    null,
    'Svelte example'
  ),
  'svelte.headlesscombobox.chrisvouga.dev': entry(
    'headless-combobox',
    'public-app',
    null,
    'Svelte example (old address)'
  ),

  // Public APIs
  'imageservice.chrisvouga.dev': entry(
    'Image Service',
    'public-api',
    'Resizes and optimizes images on demand, with no configuration.',
    'imageservice.chrisvouga.dev'
  ),
  'imageresizerservice.com': entry(
    'Image Service',
    'public-api',
    null,
    'imageresizerservice.com'
  ),
  'auth.chrisvouga.dev': entry(
    'Relay',
    'public-api',
    'Shared OIDC sign-in for the projects, backed by Google.',
    'Production'
  ),
  'auth-dev.chrisvouga.dev': entry('Relay', 'public-api', null, 'Dev'),

  // Internal dashboards
  'auth-admin.chrisvouga.dev': entry(
    'Relay admin',
    'internal-dashboard',
    'Admin console for the sign-in relay, behind Cloudflare Access.',
    'Production'
  ),
  'auth-admin-dev.chrisvouga.dev': entry(
    'Relay admin',
    'internal-dashboard',
    null,
    'Dev'
  ),
  '9router.chrisvouga.dev': entry(
    '9router',
    'internal-dashboard',
    'One endpoint that routes AI requests across model providers and accounts.'
  ),
  'zoomies.chrisvouga.dev': entry(
    'Zoomies',
    'internal-dashboard',
    'Controller for the self-hosted GitHub Actions runners.'
  ),
  'dozzle.chrisvouga.dev': entry(
    'Dozzle',
    'internal-dashboard',
    'Live container logs from the origin server.'
  ),
  'netdata.chrisvouga.dev': entry(
    'Netdata',
    'internal-dashboard',
    'Real-time metrics for the origin server.'
  ),
  'filestash.chrisvouga.dev': entry(
    'Filestash',
    'internal-dashboard',
    'A web file manager.'
  ),
  'pgweb.chrisvouga.dev': entry(
    'pgweb',
    'internal-dashboard',
    'A web client for browsing Postgres databases.'
  ),
  'orchestrator.chrisvouga.dev': entry(
    'Orchestrator',
    'internal-dashboard',
    null
  ),

  // Internal APIs
  'vault.chrisvouga.dev': entry(
    'Vault',
    'internal-api',
    'The OpenBao secrets store every service reads its credentials from.'
  ),
  'fleet.chrisvouga.dev': entry(
    'Fleet',
    'internal-api',
    'Membership and sync for the developer machine fleet.'
  ),
  'llm-proxy.chrisvouga.dev': entry(
    'LLM Proxy',
    'internal-api',
    'Routes AI model requests to any provider and records usage for cost and health.'
  ),
  'llm.chrisvouga.dev': entry(
    'Self-hosted models',
    'internal-api',
    'Language model servers on the fleet, reached through a Cloudflare Tunnel.',
    'llm'
  ),
  'openai.chrisvouga.dev': entry(
    'Self-hosted models',
    'internal-api',
    null,
    'OpenAI-compatible'
  ),
  'lm-studio.chrisvouga.dev': entry(
    'Self-hosted models',
    'internal-api',
    null,
    'LM Studio'
  ),
  'vllm.chrisvouga.dev': entry(
    'Self-hosted models',
    'internal-api',
    null,
    'vLLM'
  ),

  // Postgres
  'postgres:openbao': entry(
    'Personal Postgres',
    'postgres',
    'The shared PlanetScale Postgres: OpenBao storage and the sign-in relay schemas.'
  ),

  // Blob storage
  'blob:production': entry(
    'R2 buckets',
    'blob',
    'S3-compatible object storage for app files and backups.',
    'Production'
  ),
  'blob:development': entry('R2 buckets', 'blob', null, 'Development'),

  // Domains with nothing launched yet
  'colddrive.app': entry('colddrive.app', 'domain', null),
  'datoms.app': entry('datoms.app', 'domain', null),
  'emulates.dev': entry('emulates.dev', 'domain', null),
  'linkpage.app': entry('linkpage.app', 'domain', null),
  'patchdb.dev': entry('patchdb.dev', 'domain', null),
  'tabular.chat': entry('tabular.chat', 'domain', null),
  'thehiccups.band': entry('thehiccups.band', 'domain', null),
  'tripolar.band': entry('tripolar.band', 'domain', null),
  'voteonit.app': entry('voteonit.app', 'domain', null),
};
