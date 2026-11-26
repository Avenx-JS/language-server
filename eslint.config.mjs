// Mirrors avenx-js/eslint.config.mjs. The Avenx template parser and the
// component-tag-naming rule are left out: this repository contains no
// *.component.js / *.page.js sources.
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  js.configs.recommended,
  jsdoc.configs['flat/recommended'],

  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/*.vsix'],
  },

  {
    files: ['**/*.js', '**/*.mjs'],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',

      globals: {
        // Node / ES Module / Test globals
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        performance: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        globalThis: 'writable',
        Buffer: 'readonly',
      },
    },

    plugins: {
      jsdoc: jsdoc,
    },

    rules: {
      indent: ['error', 2, { SwitchCase: 1 }],
      quotes: [
        'error',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: true,
        },
      ],
      semi: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      camelcase: ['error', { properties: 'always' }],

      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            MethodDefinition: true,
            ClassDeclaration: true,
          },
        },
      ],

      'jsdoc/require-param': 'error',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/no-undefined-types': 'off',
      'jsdoc/reject-any-type': 'off',
      'jsdoc/reject-function-type': 'off',
      'jsdoc/check-types': 'off',
      'jsdoc/escape-inline-tags': 'off',
    },
  },

  {
    files: ['**/test/**/*.js', '**/bin/**/*.js', '*.config.js', '*.config.mjs'],

    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/check-param-names': 'off',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
    },
  },
];
