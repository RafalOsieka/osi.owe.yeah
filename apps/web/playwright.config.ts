import { defineConfig, devices } from '@playwright/test';
import webpush from 'web-push';
import { DEFAULT_DATABASE_URL } from './test/e2e/harness/postgres';

const PORT = 3100;
// Push notifications need a VAPID key pair on the server; any will do here.
const vapid = webpush.generateVAPIDKeys();

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'nuxt build && node .output/server/index.mjs',
    url: `http://localhost:${PORT}`,
    env: {
      PORT: String(PORT),
      DATABASE_URL: DEFAULT_DATABASE_URL,
      UI_E2E: '1',
      NUXT_VAPID_PUBLIC_KEY: vapid.publicKey,
      NUXT_VAPID_PRIVATE_KEY: vapid.privateKey,
      NUXT_VAPID_SUBJECT: 'mailto:test@example.com',
    },
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
