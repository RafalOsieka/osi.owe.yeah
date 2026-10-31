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

  // The Claim can be changed at any time, or the change cancelled.
  await opened.getByRole('button', { name: 'Change' }).click();
  await opened.getByRole('button', { name: 'Cancel' }).click();
  await expect(opened.getByText('You are Kasia')).toBeVisible();
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

test('retrying a Participant whose response was lost adds them once', async ({ page }) => {
  await page.goto('/trips/new');
  await page.getByLabel('Name').fill('Mazury 2026');
  await page.getByRole('button', { name: 'Create Trip' }).click();
  await expect(page.getByRole('heading', { name: 'Mazury 2026' })).toBeVisible();

  // The first add reaches the server, but its response never comes back.
  await page.route(
    '**/participants',
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await page.getByLabel('New Participant').fill('Ola');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('The Participant could not be added.')).toBeVisible();

  await page.getByLabel('New Participant').fill('Ola');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('The Participant could not be added.')).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: 'Ola' })).toHaveCount(1);
});

test('a Trip link with a wrong token shows no Trip', async ({ page }) => {
  await page.goto('/trips/019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b#not-the-token');

  await expect(page.getByRole('heading', { name: "This Trip link doesn't work." })).toBeVisible();
});

test('record a plain Expense, edit it, and see the balances', async ({ page }) => {
  await page.goto('/trips/new');
  await page.getByLabel('Name').fill('Istria 2026');
  await page.getByLabel('Participant 1').fill('Kasia');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Participant 2').fill('Ania');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Participant 3').fill('Ola');
  await page.getByRole('button', { name: 'Create Trip' }).click();
  await page.getByRole('button', { name: 'Kasia' }).click();

  // The Main payer defaults to the Claim, and everyone is ticked.
  await page.getByRole('button', { name: 'Add Expense' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel('Paid by')).toHaveText('Kasia');
  for (const name of ['Kasia', 'Ania', 'Ola']) {
    await expect(form.getByRole('checkbox', { name })).toBeChecked();
  }
  await form.getByLabel('Title').fill('Lidl Rovinj');
  // Too many decimals for EUR is refused before anything is sent.
  await form.getByLabel('Amount').fill('10,001');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Enter an amount above zero')).toBeVisible();
  await form.getByLabel('Amount').fill('10');
  await form.getByLabel('When').fill('2026-07-14T23:30');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  const expenses = page.getByRole('region', { name: 'Expenses' });
  await expect(expenses.getByRole('heading', { name: 'Tuesday, July 14, 2026' })).toBeVisible();
  await expect(expenses.getByRole('button', { name: /Lidl Rovinj/ })).toContainText('€10.00');

  // 10.00 for three doesn't split into whole cents.
  const balances = page.getByRole('region', { name: 'Balances' });
  await expect(balances.getByRole('row', { name: /Kasia/ })).toContainText('≈ €6.67');
  await expect(balances.getByRole('row', { name: /Ola/ })).toContainText('≈ -€3.33');

  await expenses.getByRole('button', { name: /Lidl Rovinj/ }).click();
  await expect(form.getByLabel('Amount')).toHaveValue('10.00');
  await expect(form.getByLabel('When')).toHaveValue('2026-07-14T23:30');
  await form.getByLabel('Amount').fill('4,50');
  await form.getByRole('checkbox', { name: 'Ola' }).uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  await expect(expenses.getByRole('button', { name: /Lidl Rovinj/ })).toContainText('€4.50');
  await expect(balances.getByRole('row', { name: /Kasia/ })).toContainText('€2.25');
  await expect(balances.getByRole('row', { name: /Ania/ })).toContainText('-€2.25');
  await expect(balances.getByRole('row', { name: /Ola/ })).toContainText('€0.00');
  await expect(balances).not.toContainText('≈');
});
