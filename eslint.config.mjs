import prettier from 'eslint-config-prettier';
import oxlint from 'eslint-plugin-oxlint';
import tsParser from '@typescript-eslint/parser';
import viteConfig from './vite.config.ts';

// No Nuxt app yet, so this is the tracker's ESLint setup without `withNuxt()` and the
// Vue/i18n/a11y layers it carries. Bring those back alongside the web app.
export default [
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tsParser,
    },
  },
  // Oxlint rules live in the `lint` block of vite.config.ts (Vite+).
  ...oxlint.buildFromOxlintConfig(viteConfig.lint),
  prettier, // Keep last: disables ESLint stylistic rules that conflict with Oxfmt.
  {
    // YAML has no ESLint parser here; Oxlint covers it.
    ignores: ['.nuxt', '.output', 'node_modules', 'dist', '**/*.yaml', '**/*.yml'],
  },
];
