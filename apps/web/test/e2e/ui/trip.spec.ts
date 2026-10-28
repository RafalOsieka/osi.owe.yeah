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

test('claim a Participant, see the Claim in My Trips, and "Add me" on another device', async ({
  page,
  browser,
}) => {
  await page.goto('/trips/new');
  await page.getByLabel('Name').fill('Tatry 2026');
  await page.getByLabel('Participant 1').fill('Kasia');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Participant 2').fill('Ania');
  await page.getByRole('button', { name: 'Create Trip' }).click();

  // First open on this device asks who you are.
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await page.getByRole('button', { name: 'Kasia' }).click();
  await expect(page.getByText('You are Kasia')).toBeVisible();
  const tripLink = page.url();

  await page.getByRole('link', { name: 'Owe Yeah' }).click();
  const listed = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Tatry 2026' }) });
  await expect(listed).toContainText('You are Kasia');

  // Another device can claim the same name: "Add me" creates a second Kasia and claims her.
  const device = await browser.newContext();
  const opened = await device.newPage();
  await opened.goto(tripLink);
  await expect(opened.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await opened.getByLabel('Not on the list?').fill('Kasia');
  await opened.getByRole('button', { name: 'Add me' }).click();
  await expect(opened.getByText('You are Kasia')).toBeVisible();
  await expect(opened.getByRole('listitem').filter({ hasText: 'Kasia' })).toHaveCount(2);

  // The Claim can be changed at any time.
  await opened.getByRole('button', { name: 'Change' }).click();
  await opened.getByRole('button', { name: 'Ania' }).click();
  await expect(opened.getByText('You are Ania')).toBeVisible();
  await device.close();
});

test('a Claim changed after coming back through My Trips is still there after a reload', async ({
  page,
}) => {
  await page.goto('/trips/new');
  await page.getByLabel('Name').fill('Bieszczady 2026');
  await page.getByLabel('Participant 1').fill('Kasia');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Participant 2').fill('Ania');
  await page.getByRole('button', { name: 'Create Trip' }).click();
  await page.getByRole('button', { name: 'Kasia' }).click();

  // Leaving the Trip page unmounts it; My Trips must still save what happens next.
  await page.getByRole('link', { name: 'Owe Yeah' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Bieszczady 2026' }).click();
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('button', { name: 'Ania' }).click();
  await expect(page.getByText('You are Ania')).toBeVisible();

  await page.reload();
  await expect(page.getByText('You are Ania')).toBeVisible();
});

test('a Trip link with a wrong token shows no Trip', async ({ page }) => {
  await page.goto('/trips/019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b#not-the-token');

  await expect(page.getByRole('heading', { name: "This Trip link doesn't work." })).toBeVisible();
});
