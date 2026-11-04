import type { EnvironmentResponse } from '@osi/owe-yeah-domain';
import { defineEventHandler, useRuntimeConfig } from 'nuxt/server';

/**
 * Whether this server is a test environment (`NUXT_TEST_ENVIRONMENT`), which the app's banner
 * warns about (#105). Asked at runtime, as the prerendered app can't carry it and the same
 * image runs on test and production.
 */
export default defineEventHandler((): EnvironmentResponse => ({
  testEnvironment: useRuntimeConfig().testEnvironment,
}));
