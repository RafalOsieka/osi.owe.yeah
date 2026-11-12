import { test as base, expect, type BrowserContext } from '@playwright/test';
import { startPushService } from '../harness/push-service';

export { expect };

/** The push-service stand-in a worker's journeys subscribe at (`test/e2e/harness`). */
export type PushService = Awaited<ReturnType<typeof startPushService>>;

/**
 * Playwright's `test` for the ui suite: a test fails when the Content Security Policy blocks
 * anything on its pages, which the browser only reports in the console. It watches the test's
 * own context and every context the test opens with `browser.newContext()`.
 *
 * `pushService` is the worker's push-service stand-in. The servers send to any endpoint in this
 * suite, so it needs no port known in advance: a journey subscribes at it with real keys and
 * reads what the server sent each device.
 */
export const test = base.extend<{ failOnCspViolation: undefined }, { pushService: PushService }>({
  failOnCspViolation: [
    async ({ browser, context }, use) => {
      const violations: string[] = [];
      const watch = (watched: BrowserContext) =>
        watched.on('console', (message) => {
          if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text());
        });
      watch(context);
      browser.on('context', watch);
      await use(undefined);
      browser.off('context', watch);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
  pushService: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern.
    async ({}, use) => {
      const pushService = await startPushService();
      await use(pushService);
      await pushService.close();
    },
    { scope: 'worker' },
  ],
});
