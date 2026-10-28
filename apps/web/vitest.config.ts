import { defineVitestProject } from '@nuxt/test-utils/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'e2e-db',
          include: ['test/e2e/db/**/*.{test,spec}.ts'],
          environment: 'node',
          globalSetup: ['test/e2e/harness/global-setup-db.ts'],
          hookTimeout: 120_000,
          testTimeout: 60_000,
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.{test,spec}.ts'],
          environment: 'nuxt',
          hookTimeout: 30_000,
        },
      }),
    ],
  },
});
