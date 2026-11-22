'use strict';

/**
 * React & React Hooks ESLint configuration for shared UI component packages.
 *
 * Layers the React and react-hooks rulesets on top of the shared TypeScript
 * base (parser, plugins and core rules), then relaxes the rules that are noisy
 * for a component library that is consumed by a Next.js app.
 *
 * @type {import('eslint').Linter.Config}
 */
const base = require('./base.js');

module.exports = {
  ...base,
  root: true,
  parserOptions: {
    ...base.parserOptions,
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: [...base.plugins, 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    ...base.rules,
    // The package targets React 17+ automatic runtime.
    'react/react-in-jsx-scope': 'off',
    // Props are typed by TypeScript; prop-types would duplicate the contract.
    'react/prop-types': 'off',
  },
};
