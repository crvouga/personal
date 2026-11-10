/**
 * The `/index/` catalog. What a person needs to know about each host: a name, one sentence, and a
 * category. Everything else on a card (status, screenshot, hosting, source)
 * is read from the inventory or probed at build time.
 *
 * `src/data/service-index.test.ts` holds this file to the inventory snapshot in both directions: a
 * host the inventory declares without an entry here fails, and an entry for
 * a host the inventory no longer declares fails. So the list cannot rot.
 *
 * Leave `description` null rather than guess: the card then shows the page's
 * own meta description, or what its status says.
 */

export const CATEGORIES = [
  'product',
  'game',
  'library',
  'ai',
  'platform',
  'ops',
  'domain',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  product: 'Apps',
  game: 'Games',
  library: 'Libraries',
  ai: 'AI',
  platform: 'Platform',
  ops: 'Ops',
  domain: 'Domains',
};

export type CatalogEntry = {
  readonly title: string;
  readonly description: string | null;
  readonly category: Category;
};

const entry = (
  title: string,
  category: Category,
  description: string | null
): CatalogEntry => ({ title, category, description });

export const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  // Apps
  'www.chrisvouga.dev': entry(
    'Portfolio',
    'product',
    'Projects, work history, writing and a generated résumé.'
  ),
  'anime.chrisvouga.dev': entry(
    'Anime Blog',
    'product',
    'A blog built as a fast static site, with content managed apart from the code.'
  ),
  'imageservice.chrisvouga.dev': entry(
    'Image Service',
    'product',
    'Resizes and optimizes images on demand, with no configuration.'
  ),
  'moviefinder.chrisvouga.dev': entry(
    'moviefinder',
    'product',
    'Movie and TV discovery with shared lists and reactive social features.'
  ),
  'moviefinder-app-rust.chrisvouga.dev': entry(
    'moviefinder · Rust',
    'product',
    'The moviefinder app built in Rust, one of several stacks compared side by side.'
  ),
  'moviefinder-app-react.chrisvouga.dev': entry(
    'moviefinder · React',
    'product',
    'The moviefinder app built in React, one of several stacks compared side by side.'
  ),
  'moviefinder-app-clojurescript.chrisvouga.dev': entry(
    'moviefinder · ClojureScript',
    'product',
    'The moviefinder app built in ClojureScript, one of several stacks compared side by side.'
  ),
  'pickflix.chrisvouga.dev': entry(
    'Pickflix',
    'product',
    'Watch trailers, write reviews and build shared movie lists with friends.'
  ),
  'todo.chrisvouga.dev': entry(
    'Todo',
    'product',
    'A task manager with user accounts and real-time sync.'
  ),

  // Games
  'connectfour.chrisvouga.dev': entry(
    'Connect Four',
    'game',
    'Connect Four with online multiplayer and a computer opponent.'
  ),
  'matchthree.chrisvouga.dev': entry(
    'Match Three',
    'game',
    'Swipe items around to line up three in a row.'
  ),
  'simonsays.chrisvouga.dev': entry(
    'Simon Says',
    'game',
    'The classic memory game, with sound, visuals and rising difficulty.'
  ),
  'snake.chrisvouga.dev': entry(
    'Snake',
    'game',
    'The classic Snake game, with smooth animation and responsive controls.'
  ),
  'violetsgarden.chrisvouga.dev': entry(
    "Violet's Garden",
    'game',
    'A cozy puzzle game about guiding a pug through garden mazes, every level proven solvable.'
  ),

  // Libraries
  'mockingbird.chrisvouga.dev': entry(
    'Mockingbird',
    'library',
    'Stateful emulators for third-party APIs and SQL databases, for end-to-end tests.'
  ),
  'headlesscombobox.chrisvouga.dev': entry(
    'headless-combobox',
    'library',
    'Docs for an accessible, framework-agnostic autocomplete component.'
  ),
  'svelte-headlesscombobox.chrisvouga.dev': entry(
    'headless-combobox · Svelte',
    'library',
    'The headless-combobox library running in a Svelte example app.'
  ),
  'svelte.headlesscombobox.chrisvouga.dev': entry(
    'headless-combobox · Svelte (old address)',
    'library',
    'An older address for the Svelte example, routed to the origin server.'
  ),

  // AI
  '9router.chrisvouga.dev': entry(
    '9router',
    'ai',
    'One endpoint that routes AI requests across model providers and accounts.'
  ),
  'llm-proxy.chrisvouga.dev': entry(
    'LLM Proxy',
    'ai',
    'Routes AI model requests to any provider and records usage for cost and health.'
  ),
  'llm.chrisvouga.dev': entry(
    'LLM endpoint',
    'ai',
    'A self-hosted language model endpoint, reached through a Cloudflare Tunnel.'
  ),
  'lm-studio.chrisvouga.dev': entry(
    'LM Studio',
    'ai',
    'An LM Studio model server, reached through a Cloudflare Tunnel.'
  ),
  'openai.chrisvouga.dev': entry(
    'OpenAI-compatible API',
    'ai',
    'An OpenAI-compatible API for self-hosted models, through a Cloudflare Tunnel.'
  ),
  'vllm.chrisvouga.dev': entry(
    'vLLM',
    'ai',
    'A vLLM inference server, reached through a Cloudflare Tunnel.'
  ),

  // Platform
  'auth.chrisvouga.dev': entry(
    'Relay',
    'platform',
    'Shared sign-in for the projects, backed by Google.'
  ),
  'auth-dev.chrisvouga.dev': entry(
    'Relay · dev',
    'platform',
    'The non-production sign-in relay, for development.'
  ),
  'auth-admin.chrisvouga.dev': entry(
    'Relay admin',
    'platform',
    'Admin console for the sign-in relay, behind Cloudflare Access.'
  ),
  'auth-admin-dev.chrisvouga.dev': entry(
    'Relay admin · dev',
    'platform',
    'Admin console for the non-production sign-in relay.'
  ),
  'vault.chrisvouga.dev': entry(
    'Vault',
    'platform',
    'The OpenBao secrets store every service reads its credentials from.'
  ),
  'fleet.chrisvouga.dev': entry(
    'Fleet',
    'platform',
    'Membership and sync for the developer machine fleet.'
  ),
  'zoomies.chrisvouga.dev': entry(
    'Zoomies',
    'platform',
    'Controller for the self-hosted GitHub Actions runners.'
  ),

  // Ops
  'dozzle.chrisvouga.dev': entry(
    'Dozzle',
    'ops',
    'Live container logs from the origin server.'
  ),
  'netdata.chrisvouga.dev': entry(
    'Netdata',
    'ops',
    'Real-time metrics for the origin server.'
  ),
  'orchestrator.chrisvouga.dev': entry('Orchestrator', 'ops', null),
  'filestash.chrisvouga.dev': entry('Filestash', 'ops', 'A web file manager.'),
  'pgweb.chrisvouga.dev': entry(
    'pgweb',
    'ops',
    'A web client for browsing Postgres databases.'
  ),

  // Domains
  'gamezilla.app': entry(
    'gamezilla.app',
    'domain',
    'A local-first multiplayer game platform for phones.'
  ),
  'moviefinder.app': entry(
    'moviefinder.app',
    'domain',
    'The moviefinder app on its own domain.'
  ),
  'normalizer.app': entry(
    'normalizer.app',
    'domain',
    'Reshapes spreadsheet data from one format into another.'
  ),
  'imageresizerservice.com': entry('imageresizerservice.com', 'domain', null),
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
