/** Conventional Commits for local commits (`pr:ready commit`) and the CI `commitlint` job. */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 120],
  },
  // Dependabot bodies carry long release-note links; its PR title is still checked.
  ignores: [(message) => message.includes('Signed-off-by: dependabot[bot]')],
};
