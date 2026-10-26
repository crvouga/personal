const { createSharedBlocks } = require('../eslint-rules/base-config.cjs');

module.exports = [
  { ignores: ['.astro/**'] },
  ...createSharedBlocks(__dirname, {
    // Astro routes are named by the framework: `[slug].png.ts` is a dynamic
    // segment, not a style choice.
    namingIgnore: [
      '^index\\.(ts|tsx|js|jsx)$',
      '^\\[[\\w.]+\\](\\.[a-z]+)*\\.ts$',
    ],
  }),
];
