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

/**
 * Creates a Trip as other devices would, with `expenses` Expenses of `amount` minor units
 * paid by the first Participant for everyone, one per day back from 1 July 2026. Returns
 * the Trip link.
 */
async function tripWithExpenses(
  request: APIRequestContext,
  name: string,
  participants: readonly string[],
  expenses: readonly { title: string; amount: number }[],
): Promise<string> {
  const id = uuidv7();
  const people = participants.map((participant) => ({ id: uuidv7(), name: participant }));
  const created = await request.post('/api/trips', {
    data: { id, name, currency: 'EUR', participants: people },
  });
  // SAFETY: a 201 from POST /api/trips always carries `{ token }`, checked just below.
  const { token } = (await created.json()) as { token: string };
  expect(created.status()).toBe(201);
  const pushed = await request.post(`/api/trips/${id}/push`, {
    headers: { 'x-trip-token': token },
    data: {
      changes: expenses.map(({ title, amount }, index) => ({
        id: uuidv7(),
        baseVersion: null,
        expense: {
          id: uuidv7(),
          title,
          currency: 'EUR',
          time: {
            instant: new Date(Date.UTC(2026, 6, 1 - index, 10)).toISOString(),
            zone: 'Europe/Zagreb',
          },
          mainPayerId: people[0]!.id,
          lineItems: [
            { unitPrice: amount, split: { mode: 'even', participantIds: people.map((p) => p.id) } },
          ],
        },
      })),
    },
  });
  expect(pushed.ok()).toBe(true);
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
  await expect(page.getByRole('link', { name: 'Add the first Expense' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add Expense' })).toBeHidden();
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
  await expect(page.getByRole('region', { name: 'Everyone' })).toBeVisible();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test('the longest texts never make a page scroll sideways at 360 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const tripName = 'Summer road trip through Croatia, Slovenia and Montenegro '
    .repeat(2)
    .slice(0, 100);
  const title = 'Konzum supermarket Rovinj, weekly groceries, drinks, sunscreen, charcoal '
    .repeat(2)
    .slice(0, 100);
  const names = ['Aleksandra Wiśniewska-Brzęczyszczykiewicz-Kowalska', 'B'.repeat(50)];
  const scrollsSideways = () =>
    page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  await page.goto(
    await tripWithExpenses(request, tripName, names, [{ title, amount: 12_345_678 }]),
  );
  const sheet = page.getByRole('dialog', { name: 'Who are you?' });
  await sheet.getByRole('button', { name: names[1] }).click();
  await expect(page.getByRole('banner')).toContainText(`You are ${names[1]}`);
  await expect(page.getByRole('link', { name: /Konzum/ })).toContainText('€123,456.78');
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('link', { name: /Konzum/ }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await expect(page.getByRole('radio', { name: names[0] })).toBeChecked();
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('region', { name: 'Everyone' })).toContainText('+61,728.39');
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await expect(page.getByText(names[1]!, { exact: true })).toBeVisible();
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

test('record a plain Expense, read it, edit it, and see the balances', async ({ page }) => {
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  // The Main payer defaults to the Claim, and everyone is ticked.
  await page.getByRole('link', { name: 'Add the first Expense' }).click();
  await expect(page.getByRole('banner')).toContainText('New Expense');
  const paidBy = page.getByRole('group', { name: 'Paid by' });
  const forWhom = page.getByRole('group', { name: 'For whom' });
  await expect(paidBy.getByRole('radio', { name: 'Kasia' })).toBeChecked();
  for (const name of ['Kasia', 'Ania', 'Ola']) {
    await expect(forWhom.getByRole('checkbox', { name })).toBeChecked();
  }
  // "All" clears everyone when everyone is ticked, and ticks everyone again.
  await page.getByRole('button', { name: 'All' }).click();
  await expect(forWhom.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'All' }).click();
  await expect(forWhom.getByRole('checkbox', { checked: true })).toHaveCount(3);

  await page.getByLabel('Title').fill('Lidl Rovinj');
  // Time and zone are one line until tapped.
  await page.getByRole('button', { name: /^When/ }).click();
  await page.getByLabel('When').fill('2026-07-14T23:30');
  // Too many decimals for EUR is refused before anything is sent.
  await page.getByLabel('Amount').fill('10,001');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByText('Enter an amount above zero')).toBeVisible();
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // Back on the Expenses tab, under the Expense's day with the day's total.
  await expect(page.getByRole('link', { name: 'Expenses' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'Tuesday, July 14, 2026' })).toBeVisible();
  const row = page.getByRole('link', { name: /Lidl Rovinj/ });
  await expect(row).toContainText('Kasia paid · for all 3');
  await expect(row).toContainText('€10.00');
  // 10.00 for three doesn't split into whole cents.
  await expect(row).toContainText('you lent ≈ 6.67');
  await expect(page.getByRole('link', { name: 'Add Expense' })).toBeVisible();

  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('heading', { name: "You're owed" })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main).toContainText('≈ €6.67');
  await expect(main).toContainText('You paid €10.00 · your share ≈ €3.33');
  const bars = page.getByRole('region', { name: 'Everyone' }).getByRole('listitem');
  await expect(bars.filter({ hasText: 'Kasia' })).toContainText('≈ +6.67');
  await expect(bars.filter({ hasText: 'Ola' })).toContainText('≈ -3.33');
  await expect(main).toContainText('Trip total €10.00');

  // The detail page shows the Expense in full; edit from there.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Lidl Rovinj' })).toBeVisible();
  await expect(main).toContainText('11:30 PM');
  const shares = page.getByRole('region', { name: 'For whom · Even' }).getByRole('listitem');
  await expect(shares).toHaveCount(3);
  await expect(shares.filter({ hasText: 'Ola' })).toContainText('≈ €3.33');

  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await expect(page.getByLabel('Amount')).toHaveValue('10.00');
  await page.getByRole('button', { name: /^When/ }).click();
  await expect(page.getByLabel('When')).toHaveValue('2026-07-14T23:30');
  await page.getByLabel('Amount').fill('4,50');
  await forWhom.getByRole('checkbox', { name: 'Ola' }).uncheck();
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // Saving returns to the detail page it was opened from.
  await expect(page.getByRole('heading', { name: 'Lidl Rovinj' })).toBeVisible();
  await expect(main).toContainText('€4.50');
  await expect(shares).toHaveCount(2);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(row).toContainText('€4.50');
  await expect(row).toContainText('you lent 2.25');

  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(bars.filter({ hasText: 'Kasia' })).toContainText('+2.25');
  await expect(bars.filter({ hasText: 'Ania' })).toContainText('-2.25');
  await expect(bars.filter({ hasText: 'Ola' })).toContainText('0.00');
  await expect(main).not.toContainText('≈');
});

test('saving a new Expense returns to the Expenses tab where it was scrolled', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const expenses = Array.from({ length: 20 }, (_, index) => ({
    title: `Expense ${index + 1}`,
    amount: 1000,
  }));
  await page.goto(await tripWithExpenses(request, 'Sopot 2026', ['Ola', 'Ania'], expenses));
  await page.getByRole('dialog').getByRole('button', { name: 'Ola' }).click();

  await page.getByRole('link', { name: /Expense 18/ }).scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('5');
  await page.getByLabel('Title').fill('Ice cream');
  await page.getByRole('button', { name: 'Save Expense' }).click();

  await expect(page.getByRole('link', { name: /Ice cream/ })).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
});
