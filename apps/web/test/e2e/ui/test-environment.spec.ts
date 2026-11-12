import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

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

  test("the banner's close button stands out from the banner in light and dark mode", async ({
    page,
  }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await open(page, '/');
      await expect(page.locator('html')).toContainClass(colorScheme);
      const close = banner(page).getByRole('button', { name: 'Close' });
      const ratio = contrast(
        await rgb(close, 'color'),
        await rgb(banner(page), 'background-color'),
      );
      expect(ratio, `in ${colorScheme} mode`).toBeGreaterThanOrEqual(3);
    }
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

type Rgb = [number, number, number];

/** The sRGB channels (0-255) of a colour property of `locator`, whatever CSS colour space it uses. */
async function rgb(locator: Locator, property: 'color' | 'background-color'): Promise<Rgb> {
  return locator.evaluate((element, name) => {
    // A canvas paints any CSS colour (oklch, color-mix) and reads it back as sRGB.
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    context.fillStyle = getComputedStyle(element).getPropertyValue(name);
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b] satisfies Rgb;
  }, property);
}

/** The WCAG 2 contrast ratio between two opaque colours, from 1 to 21. */
function contrast(a: Rgb, b: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]: Rgb) =>
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('outside a test environment, no screen shows the banner', async ({ page }) => {
  await open(page, '/');
  await everyScreen(page, () => expect(banner(page)).toBeHidden());
});
