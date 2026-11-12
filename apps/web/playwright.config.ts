import { defineConfig, devices } from '@playwright/test';
import webpush from 'web-push';
import { DEFAULT_DATABASE_URL } from './test/e2e/harness/postgres';

const PORT = 3100;
const TEST_ENVIRONMENT_PORT = 3101;
// Push notifications need a VAPID key pair on the server; any will do here.
const vapid = webpush.generateVAPIDKeys();
const env = {
  DATABASE_URL: DEFAULT_DATABASE_URL,
  UI_E2E: '1',
  NUXT_VAPID_PUBLIC_KEY: vapid.publicKey,
  NUXT_VAPID_PRIVATE_KEY: vapid.privateKey,
  NUXT_VAPID_SUBJECT: 'mailto:test@example.com',
  // The journeys subscribe at `push.example.com`, no known push service.
  NUXT_NOTIFICATIONS_ANY_ENDPOINT: 'true',
  // Every journey creates its Trips from one client address.
  NUXT_TRIPS_PER_HOUR: '1000',
};

// The ui e2e suite: user journeys in a real browser against the built app and a disposable
// Postgres. The server connects lazily, so it may start before the global setup migrates.
export default defineConfig({
  testDir: 'test/e2e/ui',
  globalSetup: './test/e2e/harness/global-setup-ui.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  // iOS Safari is the riskiest browser, so the offline and sync journeys, tagged `@webkit`,
  // also run in WebKit as an iPhone. Not on Windows, whose WebKit build closes the page once
  // it goes offline; CI runs them on Linux.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.platform === 'win32'
      ? []
      : [{ name: 'webkit', use: { ...devices['iPhone 15'] }, grep: /@webkit/ }]),
  ],
  // Two servers of one build, on one database: the first switched off as a test environment,
  // like production, and the second switched on (`test-environment.spec.ts`). Playwright
  // starts them in order, so the second waits for the build.
  webServer: [
    {
      command: 'nuxt build && node .output/server/index.mjs',
      url: `http://localhost:${PORT}`,
      env: { ...env, PORT: String(PORT) },
      timeout: 300_000,
      reuseExistingServer: false,
    },
    {
      command: 'node .output/server/index.mjs',
      url: `http://localhost:${TEST_ENVIRONMENT_PORT}`,
      env: { ...env, PORT: String(TEST_ENVIRONMENT_PORT), NUXT_TEST_ENVIRONMENT: 'true' },
      reuseExistingServer: false,
    },
  ],
});
