import { expect, test } from '@playwright/test';

test('create a Trip, open its Trip link, see the Trip', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'New Trip' }).click();
  await page.getByLabel('Name').fill('Croatia 2026');
  await page.getByRole('button', { name: 'Create Trip' }).click();
  await expect(page.getByRole('heading', { name: 'Croatia 2026' })).toBeVisible();
  const tripLink = page.url();

  // Another device: a fresh browser context that has nothing but the Trip link.
  const device = await browser.newContext();
  const opened = await device.newPage();
  await opened.goto(tripLink);

  await expect(opened.getByRole('heading', { name: 'Croatia 2026' })).toBeVisible();
  await expect(opened.getByText('Trip currency: EUR')).toBeVisible();
  await device.close();
});

test('a Trip link with a wrong token shows no Trip', async ({ page }) => {
  await page.goto('/trips/019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b#not-the-token');

  await expect(page.getByRole('heading', { name: "This Trip link doesn't work." })).toBeVisible();
});
