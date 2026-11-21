'use strict';

/**
 * Next.js ESLint configuration for the Votion web application shell.
 * Layers the Next.js core-web-vitals ruleset on top of the shared base.
 *
 * @type {import('eslint').Linter.Config}
 */
module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  settings: {
    react: {
      version: 'detect',
    },
  },
};
