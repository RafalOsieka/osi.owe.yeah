import { test as base, expect } from '@playwright/test';

export { expect };

/**
 * Playwright's `test` for the ui suite: a test fails when its page's Content Security Policy
 * blocks anything, which the browser only reports in the console. Contexts a test opens itself
 * with `browser.newContext()` aren't watched.
 */
export const test = base.extend<{ cspViolations: undefined }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      context.on('console', (message) => {
        if (message.text().includes('Content Security Policy')) violations.push(message.text());
      });
      await use(undefined);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});
