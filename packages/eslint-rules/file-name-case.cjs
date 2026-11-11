'use strict';

/**
 * ESLint rule `file-name/kebab-case`: every linted file name is kebab-case.
 * Dots separate suffixes (`foo-bar.test.ts`). `ignore` takes regex strings
 * tested against the base name and the path relative to the working directory.
 */
const path = require('node:path');

const KEBAB = /^\.*[a-z][a-z0-9]*([-.][a-z0-9]+)*$/;

const kebabCase = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Require kebab-case file names.' },
    schema: [
      {
        type: 'object',
        properties: { ignore: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const ignore = (context.options[0]?.ignore ?? []).map(
      (pattern) => new RegExp(pattern)
    );
    return {
      Program(node) {
        const relative = path
          .relative(context.cwd, context.filename)
          .split(path.sep)
          .join('/');
        const parsed = path.parse(relative);
        if (ignore.some((re) => re.test(parsed.base) || re.test(relative)))
          return;
        if (KEBAB.test(parsed.name)) return;
        context.report({
          node,
          message: `File name "${parsed.base}" must be kebab-case.`,
        });
      },
    };
  },
};

module.exports = { rules: { 'kebab-case': kebabCase } };
