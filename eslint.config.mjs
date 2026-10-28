// https://eslint.nuxt.com
import withNuxt from './apps/web/.nuxt/eslint.config.mjs';
import prettier from 'eslint-config-prettier';
import oxlint from 'eslint-plugin-oxlint';
import vueA11y from 'eslint-plugin-vuejs-accessibility';
import vueI18n from '@intlify/eslint-plugin-vue-i18n';
import tsParser from '@typescript-eslint/parser';
import viteConfig from './vite.config.ts';

export default withNuxt()
  .prepend({
    // The Nuxt preset misses the TypeScript parser for `<script lang="ts">` in .vue files,
    // which reports false issues.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
      },
    },
  })
  .append(vueA11y.configs['flat/recommended']) // Accessibility rules (before Prettier)
  .append({
    rules: {
      // Nuxt UI form controls render native inputs; declare them as control components
      // so label-has-for can verify label association without inline disables.
      'vuejs-accessibility/label-has-for': [
        'error',
        {
          controlComponents: [
            'UInput',
            'UTextarea',
            'USelect',
            'USelectMenu',
            'UInputMenu',
            'UInputNumber',
            'UInputDate',
            'UInputTime',
            'UInputTags',
            'UPinInput',
            'UCheckbox',
            'UCheckboxGroup',
            'URadioGroup',
            'USwitch',
            'USlider',
            'UFileUpload',
          ],
          required: { some: ['nesting', 'id'] },
        },
      ],
    },
  })
  .append(...vueI18n.configs['flat/recommended']) // i18n rules (before Prettier)
  .append({
    rules: {
      // No raw text in templates; ignore icon-only content, punctuation and numeric/unit literals.
      '@intlify/vue-i18n/no-raw-text': [
        'error',
        {
          ignoreNodes: ['script', 'style'],
          ignorePattern: '^[-#:()&+×/°′″%.,!?@\\s]+$',
          ignoreText: ['Owe Yeah'],
        },
      ],
    },
    settings: {
      'vue-i18n': {
        localeDir: './apps/web/i18n/locales/*.json',
        messageSyntaxVersion: '^9.0.0',
      },
    },
  })
  .append({
    files: ['**/*.vue'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'VariableDeclarator[id.name="props"] > CallExpression[callee.name="defineProps"]',
          message:
            'Destructure defineProps() instead of assigning to `props` (Vue 3.5 keeps destructured props reactive).',
        },
      ],
    },
  })
  .append({
    // Nuxt names pages and layouts after their route or role (`index`, `default`).
    files: ['apps/web/app/pages/**/*.vue', 'apps/web/app/layouts/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  })
  .override('nuxt/typescript/rules', {
    rules: {
      // Boundary types stay explicit; no type erosion through `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  })
  // Oxlint rules live in the `lint` block of vite.config.ts (Vite+).
  .append(...oxlint.buildFromOxlintConfig(viteConfig.lint))
  .append(prettier) // Keep last: disables ESLint stylistic rules that conflict with Oxfmt.
  .append({
    // YAML has no ESLint parser here; Oxlint covers it.
    ignores: [
      '.nuxt',
      '.output',
      'node_modules',
      'dist',
      'apps/web/.nuxt',
      'apps/web/.output',
      'packages/*/dist',
      '**/*.yaml',
      '**/*.yml',
    ],
  });
