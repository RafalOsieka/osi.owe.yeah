import { expect, test, type Locator, type Page } from '@playwright/test';

// The suite's second server runs the same build switched on as a test environment
// (`playwright.config.ts`); the first one, every other test's, is switched off.
const TEST_ENVIRONMENT_URL = 'http://localhost:3101';

/** The test-environment banner, on whatever screen the page shows. */
const banner = (page: Page) => page.getByRole('note');

/** Opens `path` and waits for the server's answer on whether it is a test environment. */
async function open(page: Page, path: string): Promise<void> {
  const answer = page.waitForResponse('**/api/environment');
  await page.goto(path);
  await answer;
}

/**
 * Walks through a screen of every kind: My Trips, New Trip, a Trip's three tabs, New Expense,
 * the privacy notice and a page that doesn't exist. Calls `check` on each.
 */
async function everyScreen(page: Page, check: () => Promise<void>): Promise<void> {
  await check();
  await page.getByRole('link', { name: 'New Trip' }).click();
  await check();
  await page.getByLabel('Trip name').fill('Hel 2026');
  await page.getByLabel('Your name').fill('Ania');
  await page.getByLabel('Participant 2').fill('Kasia');
  await page.getByRole('button', { name: 'Create Trip' }).click();
  await expect(page.getByRole('banner')).toContainText('You are Ania');
  await check();
  await page.getByRole('link', { name: 'Balances' }).click();
  await check();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await check();
  await page.getByRole('link', { name: 'Expenses' }).click();
  await page.getByRole('link', { name: 'Add Expense' }).click();
  await check();
  await open(page, '/privacy');
  await check();
  await open(page, '/nonexistent-page');
  await expect(page.getByRole('heading', { name: "This page doesn't exist." })).toBeVisible();
  await check();
}

test.describe('in a test environment', () => {
  test.use({ baseURL: TEST_ENVIRONMENT_URL });

  test('every screen warns that its data may be wiped, also offline', async ({ page, context }) => {
    await open(page, '/');
    await everyScreen(page, () =>
      expect(banner(page)).toHaveText(
        "Test environment: data may be wiped, don't enter anything sensitive",
      ),
    );

    // Offline, the app remembers what the server last said.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
  });

  test('a closed banner stays closed until the app is opened again', async ({ page }) => {
    await open(page, '/');
    await banner(page).getByRole('button', { name: 'Close' }).click();
    await expect(banner(page)).toBeHidden();

    await page.getByRole('link', { name: 'New Trip' }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
    await expect(banner(page)).toBeHidden();

    await page.reload();
    await expect(banner(page)).toBeVisible();
  });

  test('under the banner, the New Trip button leaves the footer links on My Trips clear', async ({
    page,
  }) => {
    await open(page, '/');
    await page.getByRole('link', { name: 'New Trip' }).click();
    await page.getByLabel('Trip name').fill('Hel 2026');
    await page.getByLabel('Your name').fill('Ania');
    await page.getByLabel('Participant 2').fill('Kasia');
    await page.getByRole('button', { name: 'Create Trip' }).click();
    await expect(page.getByRole('banner')).toContainText('You are Ania');
    await open(page, '/');

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(banner(page)).toBeVisible();
      const button = await box(page.getByRole('link', { name: 'New Trip' }));
      for (const name of ['Privacy notice', 'Terms of service']) {
        const link = page.getByRole('link', { name });
        await expect(link, `${name} at ${viewport.width} px`).toBeInViewport({ ratio: 1 });
        expect(overlaps(await box(link), button), `${name} at ${viewport.width} px`).toBe(false);
      }
    }
  });
});

/** Where `locator` is on the screen, without scrolling to it. */
async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error(`${locator} is not on the page`);
  return found;
}

type Box = Awaited<ReturnType<typeof box>>;

/** Whether two boxes on the screen share any area. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('outside a test environment, no screen shows the banner', async ({ page }) => {
  await open(page, '/');
  await everyScreen(page, () => expect(banner(page)).toBeHidden());
});
