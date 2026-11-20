// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  { ignores: ['dist/', '.angular/', 'node_modules/', 'playwright-report/', 'test-results/', 'e2e/fixtures/'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
    },
  },
  {
    // The signers' application and the management application share libraries but no page.
    files: ['src/app/dts/**/*.ts', 'src/dts-app/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '(^|/)dts-admin(-app)?(/|$)', message: 'The sign application must not import from the management application.' }] }],
    },
  },
  {
    files: ['src/app/dts-admin/**/*.ts', 'src/dts-admin-app/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '(^|/)(dts/sign/|dts-sign-engine|dts-app/)', message: 'The management application must not import the sign page or its engine.' }] }],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      // `!= null` deliberately covers both null and undefined
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
    },
  },
);
