import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';

/** Creates a Trip as someone else's device would, and returns its Trip link. */
async function tripLinkFor(
  request: APIRequestContext,
  name: string,
  participants: readonly string[],
): Promise<string> {
  const id = uuidv7();
  const response = await request.post('/api/trips', {
    data: {
      id,
      name,
      currency: 'EUR',
      participants: participants.map((participant) => ({ id: uuidv7(), name: participant })),
    },
  });
  expect(response.status()).toBe(201);
  // SAFETY: a 201 from POST /api/trips always carries `{ token }`, checked just above.
  const { token } = (await response.json()) as { token: string };
  return `/trips/${id}#${token}`;
}

/** Creates a Trip through New Trip, as `me`, and lands on it. */
async function createTrip(
  page: Page,
  name: string,
  me: string,
  others: readonly string[],
): Promise<void> {
  await page.goto('/trips/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Your name').fill(me);
  for (const [index, other] of others.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Add another' }).click();
    await page.getByLabel(`Participant ${index + 2}`).fill(other);
  }
  await page.getByRole('button', { name: 'Create Trip' }).click();
  await expect(page.getByRole('banner')).toContainText(`You are ${me}`);
}

test('a new Trip lands on its empty Expenses tab, already knowing who you are', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'New Trip' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Croatia 2026');
  await page.getByLabel('Your name').fill('Ania');
  await page.getByLabel('Participant 2').fill('Kasia');
  await page.getByRole('button', { name: 'Create Trip' }).click();

  const header = page.getByRole('banner');
  await expect(header.getByRole('heading', { name: 'Croatia 2026' })).toBeVisible();
  await expect(header).toContainText('You are Ania · EUR');
  // The token is on the device now, not in the address bar.
  await expect(page).toHaveURL(/\/trips\/[\w-]+$/);
  await expect(page.getByRole('button', { name: 'Add the first Expense' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Expense' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Expenses' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Back from the Trip goes to My Trips, not to the finished form.
  await header.getByRole('button', { name: 'Back to My Trips' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: /Croatia 2026/ })).toContainText('You are Ania');
});

test('joining with a Trip link keeps its token on the device', async ({
  page,
  request,
  browser,
}) => {
  const tripLink = await tripLinkFor(request, 'Tatry 2026', ['Kasia', 'Ania']);
  const tripUrl = tripLink.split('#')[0]!;

  // The first open asks who you are; "Just looking" leaves it for later.
  await page.goto(tripLink);
  const sheet = page.getByRole('dialog', { name: 'Who are you?' });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(tripUrl);
  await sheet.getByRole('button', { name: 'Just looking' }).click();
  await expect(sheet).toBeHidden();
  const header = page.getByRole('banner');
  await expect(header).toContainText('Who are you? · EUR');

  // Coming back through My Trips needs no link, and doesn't ask again.
  await header.getByRole('button', { name: 'Back to My Trips' }).click();
  await expect(page.getByRole('link', { name: /Tatry 2026/ })).toContainText('Who are you?');
  await page.getByRole('link', { name: /Tatry 2026/ }).click();
  await expect(header.getByRole('heading', { name: 'Tatry 2026' })).toBeVisible();
  await expect(sheet).toBeHidden();

  // The subtitle asks on request.
  await header.getByRole('button', { name: 'Who are you? · EUR' }).click();
  await sheet.getByRole('button', { name: 'Kasia' }).click();
  await expect(header).toContainText('You are Kasia · EUR');

  // A device that has never had the link can't open the Trip by its address alone.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(tripUrl);
  await expect(
    strangerPage.getByRole('heading', { name: "This Trip link doesn't work." }),
  ).toBeVisible();
  await stranger.close();
});

test('"Add me", and changing who you are from the Trip tab, last past a reload', async ({
  page,
  request,
}) => {
  const tripLink = await tripLinkFor(request, 'Bieszczady 2026', ['Kasia', 'Ania']);
  await page.goto(tripLink);

  // Another Kasia can say who she is too: "Add me" creates a second Kasia and claims her.
  const sheet = page.getByRole('dialog', { name: 'Who are you?' });
  await sheet.getByLabel('Not on the list?').fill('Kasia');
  await sheet.getByRole('button', { name: 'Add me' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('banner')).toContainText('You are Kasia');

  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  const participants = page.getByRole('region', { name: 'Participants' });
  await expect(participants.getByRole('listitem').filter({ hasText: 'Kasia' })).toHaveCount(2);
  await expect(participants.getByRole('listitem').filter({ hasText: 'you' })).toHaveCount(1);

  // "Who you are" changes the Claim, or cancelling keeps it.
  await page.getByRole('button', { name: /Who you are/ }).click();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: /Who you are/ })).toContainText('Kasia');
  await page.getByRole('button', { name: /Who you are/ }).click();
  await sheet.getByRole('button', { name: 'Ania' }).click();
  await expect(page.getByRole('button', { name: /Who you are/ })).toContainText('Ania');

  await page.reload();
  await expect(page.getByRole('banner')).toContainText('You are Ania');
  await expect(sheet).toBeHidden();
});

test('system back closes an open sheet before it leaves the Trip', async ({ page, request }) => {
  const tripLink = await tripLinkFor(request, 'Mazury 2026', ['Ola']);
  await page.goto(tripLink);
  const sheet = page.getByRole('dialog', { name: 'Who are you?' });
  await sheet.getByRole('button', { name: 'Just looking' }).click();
  const header = page.getByRole('banner');
  await header.getByRole('button', { name: 'Back to My Trips' }).click();

  // Within the app, as a user gets there: My Trips, the Trip, then the sheet.
  await page.getByRole('link', { name: /Mazury 2026/ }).click();
  const tripUrl = tripLink.split('#')[0]!;
  await expect(page).toHaveURL(tripUrl);
  await header.getByRole('button', { name: 'Who are you? · EUR' }).click();
  await expect(sheet).toBeVisible();

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(tripUrl);

  await page.goBack();
  await expect(page).toHaveURL('/');
});

test('each Trip tab keeps its scroll position', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const names = Array.from({ length: 30 }, (_, index) => `Participant ${index + 1}`);
  await page.goto(await tripLinkFor(request, 'Kraków 2026', names));
  await page.getByRole('dialog').getByRole('button', { name: 'Just looking' }).click();

  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByText('Participant 25', { exact: true }).scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test('the longest names never make a page scroll sideways at 360 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const tripName = 'Summer road trip through Croatia, Slovenia and Montenegro '
    .repeat(2)
    .slice(0, 100);
  const names = ['Aleksandra Wiśniewska-Brzęczyszczykiewicz-Kowalska', 'B'.repeat(50)];
  const scrollsSideways = () =>
    page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  await page.goto(await tripLinkFor(request, tripName, names));
  const sheet = page.getByRole('dialog', { name: 'Who are you?' });
  await sheet.getByRole('button', { name: names[0] }).click();
  await expect(page.getByRole('banner')).toContainText('You are Aleksandra');
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await expect(page.getByText(names[1]!)).toBeVisible();
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('banner').getByRole('button', { name: 'Back to My Trips' }).click();
  await expect(page.getByRole('link', { name: tripName.slice(0, 20) })).toBeVisible();
  expect(await scrollsSideways()).toBe(false);
});

test('retrying a Participant whose response was lost adds them once', async ({ page }) => {
  await createTrip(page, 'Mazury 2026', 'Kasia', []);
  await page.getByRole('link', { name: 'Trip', exact: true }).click();

  // The first add reaches the server, but its response never comes back.
  await page.route(
    '**/participants',
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Add Participant' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add Participant' });
  await sheet.getByLabel('Name').fill('Ola');
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet.getByText('The Participant could not be added.')).toBeVisible();

  await sheet.getByLabel('Name').fill('Ola');
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet).toBeHidden();
  const participants = page.getByRole('region', { name: 'Participants' });
  await expect(participants.getByRole('listitem').filter({ hasText: 'Ola' })).toHaveCount(1);
});

test('a Trip link with a wrong token shows no Trip', async ({ page }) => {
  await page.goto('/trips/019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b#not-the-token');

  await expect(page.getByRole('heading', { name: "This Trip link doesn't work." })).toBeVisible();
});

test('record a plain Expense, edit it, and see the balances', async ({ page }) => {
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  // The Main payer defaults to the Claim, and everyone is ticked.
  await page.getByRole('button', { name: 'Add the first Expense' }).click();
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

  await expect(page.getByRole('heading', { name: 'Tuesday, July 14, 2026' })).toBeVisible();
  const expense = page.getByRole('button', { name: /Lidl Rovinj/ });
  await expect(expense).toContainText('€10.00');

  // 10.00 for three doesn't split into whole cents.
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('row', { name: /Kasia/ })).toContainText('≈ €6.67');
  await expect(page.getByRole('row', { name: /Ola/ })).toContainText('≈ -€3.33');

  // With an Expense listed, adding another is the floating button.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByRole('button', { name: 'Add Expense' })).toBeVisible();
  await expense.click();
  await expect(form.getByLabel('Amount')).toHaveValue('10.00');
  await expect(form.getByLabel('When')).toHaveValue('2026-07-14T23:30');
  await form.getByLabel('Amount').fill('4,50');
  await form.getByRole('checkbox', { name: 'Ola' }).uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(expense).toContainText('€4.50');

  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('row', { name: /Kasia/ })).toContainText('€2.25');
  await expect(page.getByRole('row', { name: /Ania/ })).toContainText('-€2.25');
  await expect(page.getByRole('row', { name: /Ola/ })).toContainText('€0.00');
  await expect(page.getByRole('table')).not.toContainText('≈');
});
