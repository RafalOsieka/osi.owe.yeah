import { test as base, expect, type BrowserContext } from '@playwright/test';

export { expect };

/**
 * Playwright's `test` for the ui suite: a test fails when the Content Security Policy blocks
 * anything on its pages, which the browser only reports in the console. It watches the test's
 * own context and every context the test opens with `browser.newContext()`.
 */
export const test = base.extend<{ failOnCspViolation: undefined }>({
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
});
