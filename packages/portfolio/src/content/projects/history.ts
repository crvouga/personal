/**
 * When each project was written, as recorded by git — the evidence behind the
 * "Hand-written" badge. Snapshot taken 2026-10-12.
 *
 *   commits   Commits per calendar year on the default branch, summed across
 *             the project's repositories.
 *   employer  The repository belongs to an employer, so its history is not
 *             mine to count. `year` is when the project was first listed in
 *             this portfolio's own history, capped at the year the role
 *             ended: the work existed by then.
 *
 * Keyed by project id. Add an entry with every new project; `authorshipOf` in
 * `src/lib/authorship.ts` turns these into the badge.
 */
export type ProjectHistory =
  | {
      readonly t: 'commits';
      readonly byYear: Readonly<Record<number, number>>;
    }
  | { readonly t: 'employer'; readonly year: number };

const commits = (byYear: Readonly<Record<number, number>>): ProjectHistory => ({
  t: 'commits',
  byYear,
});

const employer = (year: number): ProjectHistory => ({ t: 'employer', year });

export const PROJECT_HISTORY: Readonly<Record<string, ProjectHistory>> = {
  // The current repository only. gamezilla.app-legacy (2021–2025) is the
  // earlier codebase, not the one the card describes.
  gamezilla: commits({ 2026: 3593 }),
  'geviti-app': employer(2026),
  triangulator: employer(2024),
  'study-hall': employer(2024),
  mockingbird: commits({ 2026: 977 }),
  // The monorepo also carries this portfolio's history from 2020; the platform
  // itself is the 2026 bulk.
  'workspace-platform': commits({
    2020: 26,
    2021: 304,
    2022: 81,
    2023: 7,
    2024: 139,
    2025: 100,
    2026: 995,
  }),
  'headless-combobox': commits({ 2023: 254, 2024: 76, 2025: 10, 2026: 2 }),
  orchard: employer(2024),
  'normalizer-app': commits({ 2025: 539, 2026: 49 }),
  'image-service': commits({ 2024: 19, 2025: 127, 2026: 3 }),
  'screenshot-service': commits({ 2021: 47, 2022: 268, 2025: 15, 2026: 12 }),
  // The Rust, Go, React and ClojureScript repositories together.
  'moviefinder-app': commits({ 2024: 607, 2025: 732, 2026: 47 }),
  'asu-earned-admissions': employer(2025),
  airr: employer(2024),
  'sun-devils': employer(2024),
  'violets-garden': commits({ 2026: 11 }),
  'llm-proxy': commits({ 2026: 203 }),
  'todo-app': commits({ 2022: 116, 2024: 1, 2025: 5, 2026: 6 }),
  'connect-four': commits({ 2020: 67, 2021: 6, 2022: 8, 2025: 1, 2026: 3 }),
  'quiz-maker': commits({ 2022: 47, 2023: 6, 2026: 1 }),
  'courier-website': commits({ 2022: 91, 2025: 2 }),
  'anime-blog': commits({ 2022: 60, 2025: 6, 2026: 2 }),
  'snake-game': commits({ 2022: 7, 2025: 4, 2026: 3 }),
  'match-three': commits({ 2020: 22, 2021: 12, 2025: 2, 2026: 3 }),
  'simon-says': commits({ 2020: 19, 2021: 10, 2022: 2, 2025: 2, 2026: 4 }),
  cheese: commits({ 2021: 52, 2022: 2, 2026: 3 }),
  pickflix: commits({ 2020: 490, 2021: 95, 2022: 17, 2025: 3, 2026: 17 }),
};
