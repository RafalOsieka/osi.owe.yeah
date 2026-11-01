import { randomBytes } from 'node:crypto';
import type { PushRequest, SyncChange } from '@osi/owe-yeah-domain';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';

/**
 * Creates a Trip as someone else's device would, by its first push, with `expenses` Expenses
 * of `amount` minor units paid by the first Participant for everyone, one per day back from
 * 1 July 2026. Returns the Trip link.
 */
async function tripWithExpenses(
  request: APIRequestContext,
  name: string,
  participants: readonly string[],
  expenses: readonly { title: string; amount: number }[] = [],
): Promise<string> {
  const id = uuidv7();
  const token = randomBytes(32).toString('base64url');
  const meta = { claimId: null, deviceId: uuidv7() };
  const people = participants.map((participant) => ({ id: uuidv7(), name: participant }));
  const changes: SyncChange[] = [
    { ...meta, id: uuidv7(), kind: 'trip', trip: { name, currency: 'EUR' } },
    ...people.map((participant) => ({
      ...meta,
      id: uuidv7(),
      kind: 'participant' as const,
      participant,
    })),
    ...expenses.map(({ title, amount }, index) => ({
      ...meta,
      id: uuidv7(),
      kind: 'expense' as const,
      baseVersion: null,
      expense: {
        id: uuidv7(),
        title,
        currency: 'EUR' as const,
        time: {
          instant: new Date(Date.UTC(2026, 6, 1 - index, 10)).toISOString(),
          zone: 'Europe/Zagreb',
        },
        mainPayerId: people[0]!.id,
        lineItems: [
          {
            name: '',
            unitPrice: amount,
            quantity: 1,
            split: { mode: 'even' as const, participantIds: people.map((p) => p.id) },
          },
        ],
      },
      deleted: false,
    })),
  ];
  const pushed = await request.post(`/api/trips/${id}/push`, {
    headers: { 'x-trip-token': token },
    data: { changes },
  });
  expect(pushed.ok()).toBe(true);
  return `/trips/${id}#${token}`;
}

/** Creates a Trip as someone else's device would, and returns its Trip link. */
function tripLinkFor(
  request: APIRequestContext,
  name: string,
  participants: readonly string[],
): Promise<string> {
  return tripWithExpenses(request, name, participants);
}

/**
 * The Trip link of the only Trip on this device, read from its device store, as there is no
 * Invite to show it yet (#39).
 */
function tripLinkOnDevice(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const opened = indexedDB.open('owe-yeah');
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const read = opened.result.transaction('trips').objectStore('trips').getAll();
          read.onsuccess = () => {
            const [trip] = read.result;
            resolve(`/trips/${trip.id}#${trip.token}`);
          };
        };
      }),
  );
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

test('a Trip and an Expense made offline reach a second device once back online', async ({
  page,
  context,
  browser,
}) => {
  // Opened once online, the app installs its service worker and then works offline.
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);

  await page.getByRole('link', { name: 'New Trip' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Mazury 2026');
  await page.getByLabel('Your name').fill('Kasia');
  await page.getByLabel('Participant 2').fill('Ania');
  await page.getByRole('button', { name: 'Create Trip' }).click();
  const header = page.getByRole('banner');
  await expect(header).toContainText('You are Kasia');

  await page.getByRole('link', { name: 'Add the first Expense' }).click();
  await page.getByLabel('Amount').fill('59');
  await page.getByLabel('Title').fill('Ferry tickets');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  const row = page.getByRole('link', { name: /Ferry tickets/ });
  await expect(row).toContainText('not synced');
  // The Trip, Kasia, Ania and the Expense.
  await header.getByRole('button', { name: '4 changes not synced yet' }).click();
  await expect(page.getByRole('dialog')).toContainText('sync on their own');
  await page.keyboard.press('Escape');

  await context.setOffline(false);
  await expect(header.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await expect(row).not.toContainText('not synced');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(await tripLinkOnDevice(page));
  await otherPage.getByRole('dialog').getByRole('button', { name: 'Ania' }).click();
  await expect(otherPage.getByRole('link', { name: /Ferry tickets/ })).toContainText(
    'Kasia paid · for all 2',
  );
  await other.close();
});

test('a Receipt entered offline at the till, Line item by Line item, reaches a second device', async ({
  page,
  context,
  browser,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add the first Expense' }).click();
  await page.getByLabel('Title').fill('Lidl Rovinj');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  const addLine = async (price: string, name: string, quantity = '1') => {
    await adding.getByLabel('New Line item unit price').fill(price);
    await adding.getByLabel('New Line item quantity').fill(quantity);
    await adding.getByLabel('New Line item name').fill(name);
    await adding.getByRole('button', { name: 'Add' }).click();
  };
  const lines = page.getByRole('region', { name: 'Line items' }).getByRole('listitem');
  const line = (name: string) => lines.filter({ hasText: name }).first();

  // Six waters copy the bread's Even split, then go to Kasia and Ania by Units.
  await addLine('2,49', 'Bread');
  await addLine(',29', 'Water', '6');
  await expect(line('Water')).toContainText('6 × 0.29 · Even · for all 3');
  await line('Water').getByRole('button', { name: /Water/ }).click();
  await line('Water').getByRole('button', { name: 'Units' }).click();
  await expect(line('Water')).toContainText('€1.74 not assigned yet');
  await line('Water').getByLabel('Units for Kasia').fill('3');
  await line('Water').getByLabel('Units for Ania').fill('3');
  await line('Water').getByLabel('Units for Ania').blur();
  await expect(line('Water')).toContainText('6 of 6 units assigned');
  await expect(line('Water')).not.toContainText('not assigned yet');

  // After a Units split the next line starts Even across everyone; nobody had it yet.
  await addLine('0,89', 'Chocolate');
  await expect(line('Chocolate')).toContainText('Even · for all 3');
  await line('Chocolate')
    .getByRole('button', { name: /Chocolate/ })
    .click();
  await line('Chocolate').getByRole('button', { name: 'All', exact: true }).click();
  await expect(line('Chocolate')).toContainText('Even · nobody yet');
  // Reordered to match the paper Receipt.
  await line('Chocolate').getByRole('button', { name: 'Move up' }).click();
  await expect(lines).toHaveText([/Bread/, /Chocolate/, /Water/]);

  await expect(page.getByRole('status', { name: 'Receipt total' })).toHaveText('€5.12');
  await expect(page.getByRole('main')).toContainText(
    "€0.89 not assigned yet, counted as Kasia's until it is.",
  );
  await page.getByRole('button', { name: 'Save Expense' }).click();
  const row = page.getByRole('link', { name: /Lidl Rovinj/ });
  await expect(row).toContainText('not synced');
  await expect(row).toContainText('1 unassigned');
  await expect(row).toContainText('Receipt · 3 items');

  await context.setOffline(false);
  await expect(row).not.toContainText('not synced');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(await tripLinkOnDevice(page));
  await otherPage.getByRole('dialog').getByRole('button', { name: 'Ania' }).click();
  const otherRow = otherPage.getByRole('link', { name: /Lidl Rovinj/ });
  // A third of the bread and three waters: 0.83 + 0.87.
  await expect(otherRow).toContainText('your share 1.70');
  await expect(otherRow).toContainText('1 unassigned');
  await otherRow.click();
  const items = otherPage.getByRole('region', { name: 'Line items' }).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText('Chocolate');
  await expect(items.nth(2)).toContainText('6 × 0.29 · Units · Kasia 3, Ania 3');
  await other.close();
});

test('a Line discount follows the Units and a Receipt discount is shared by what is left', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add the first Expense' }).click();
  await page.getByLabel('Title').fill('Konoba');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  await adding.getByLabel('New Line item unit price').fill('2,00');
  await adding.getByLabel('New Line item quantity').fill('5');
  await adding.getByLabel('New Line item name').fill('Beer');
  await adding.getByRole('button', { name: 'Add' }).click();

  const beer = page.getByRole('region', { name: 'Line items' }).getByRole('listitem').first();
  await beer.getByRole('button', { name: /Beer/ }).click();
  await beer.getByRole('button', { name: 'Units' }).click();
  await beer.getByLabel('Units for Kasia').fill('2');
  await beer.getByLabel('Units for Ania').fill('2');
  await beer.getByLabel('Units for Ola').fill('1');
  await beer.getByRole('textbox', { name: 'Line discount' }).fill('1');
  await expect(beer).toContainText('Discount -€1.00');
  const total = page.getByRole('status', { name: 'Receipt total' });
  await expect(total).toHaveText('€9.00');

  // 10.00 off is more than the 9.00 left after the Line discount; 10 % is not.
  const receiptDiscount = page.getByRole('textbox', { name: 'Receipt discount' });
  await receiptDiscount.fill('10');
  await expect(page.getByRole('main')).toContainText(
    'The discount is larger than the Line items after their own discounts.',
  );
  await page
    .getByRole('group', { name: 'Receipt discount: amount or percent' })
    .getByRole('button', { name: '%' })
    .click();
  await expect(total).toHaveText('€8.10');
  await expect(page.getByRole('main')).toContainText('Receipt discount -10% · -€0.90');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  const row = page.getByRole('link', { name: /Konoba/ });
  await expect(row).not.toContainText('not synced');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(await tripLinkOnDevice(page));
  await otherPage.getByRole('dialog').getByRole('button', { name: 'Ania' }).click();
  const otherRow = otherPage.getByRole('link', { name: /Konoba/ });
  // Two beers at 1.80 after the Line discount, less 10 %.
  await expect(otherRow).toContainText('your share 3.24');
  await otherRow.click();
  const main = otherPage.getByRole('main');
  await expect(main).toContainText('Discount -€1.00');
  await expect(main).toContainText('Receipt discount');
  await expect(main).toContainText('-10% · -€0.90');
  await other.close();
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
  // Balances are rounded so they add up to zero: the cent left over goes to Ola, the
  // Participant added last, on the tie.
  await expect(main).toContainText('€6.67');
  await expect(main).toContainText('You paid €10.00 · your share ≈ €3.33');
  const bars = page.getByRole('region', { name: 'Everyone' }).getByRole('listitem');
  await expect(bars.filter({ hasText: 'Kasia' })).toContainText('+6.67');
  await expect(bars.filter({ hasText: 'Ania' })).toContainText('-3.33');
  await expect(bars.filter({ hasText: 'Ola' })).toContainText('-3.34');
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

test('settle up: Income, then the suggested Repayments, until the Trip is Settled', async ({
  page,
}) => {
  await createTrip(page, 'Alps 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add the first Expense' }).click();
  await page.getByLabel('Amount').fill('30');
  await page.getByLabel('Title').fill('Hut');
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // Ola got a 6.00 Deposit refund back for everyone: Income, typed without a minus.
  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('6');
  await page.getByRole('switch', { name: 'Money received' }).click();
  await expect(page.getByRole('banner')).toContainText('New Income');
  await page
    .getByRole('group', { name: 'Received by' })
    .getByRole('radio', { name: 'Ola' })
    .check();
  await page.getByLabel('Title').fill('Bottles');
  await page.getByRole('button', { name: 'Save Income' }).click();
  const income = page.getByRole('link', { name: /Bottles/ });
  await expect(income).toContainText('Ola received · for all 3');
  await expect(income).toContainText('-€6.00');
  await expect(income).toContainText('you get back 2.00');

  // Kasia is owed 22.00: Ola owes 14.00 and Ania 8.00. The total is net of the Income.
  await page.getByRole('link', { name: 'Balances' }).click();
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { name: "You're owed" })).toBeVisible();
  await expect(main).toContainText('€22.00');
  await expect(main).toContainText('Trip total €24.00');
  const toSettle = page.getByRole('region', { name: 'To settle' }).getByRole('listitem');
  await expect(toSettle).toHaveCount(2);
  await expect(toSettle.nth(0)).toContainText(/Ola pays yous*€14.00/);
  await expect(toSettle.nth(1)).toContainText(/Ania pays yous*€8.00/);

  // Recording from a suggestion fills it in; the amount can be lowered for a partial one.
  await toSettle.nth(0).getByRole('link', { name: 'Record Repayment' }).click();
  await expect(page.getByRole('banner')).toContainText('New Repayment');
  await expect(page.getByLabel('Amount')).toHaveValue('14.00');
  await expect(
    page.getByRole('group', { name: 'Paid by' }).getByRole('radio', { name: 'Ola' }),
  ).toBeChecked();
  await expect(
    page.getByRole('group', { name: 'Paid to' }).getByRole('radio', { name: 'Kasia' }),
  ).toBeChecked();
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Save Repayment' }).click();

  // Back on Balances: Ola still owes 4.00, and Repayments are not spending.
  await expect(toSettle).toHaveCount(2);
  await expect(toSettle.nth(0)).toContainText(/Ania pays yous*€8.00/);
  await expect(toSettle.nth(1)).toContainText(/Ola pays yous*€4.00/);
  await expect(main).toContainText('Trip total €24.00');

  await toSettle.first().getByRole('link', { name: 'Record Repayment' }).click();
  await page.getByRole('button', { name: 'Save Repayment' }).click();
  await expect(toSettle).toHaveCount(1);
  await toSettle.first().getByRole('link', { name: 'Record Repayment' }).click();
  await page.getByRole('button', { name: 'Save Repayment' }).click();
  await expect(page.getByRole('heading', { name: 'All settled' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'To settle' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Expenses' }).click();
  const repayment = page.getByRole('link', { name: /Repayment/ }).filter({ hasText: '€10.00' });
  await expect(repayment).toContainText('Ola → Kasia');
  await expect(repayment).toContainText('you received 10.00');

  // My Trips marks it Settled, below a Trip that isn't, though it was opened last.
  await createTrip(page, 'Lakes 2026', 'Kasia', ['Ania']);
  await page.getByRole('button', { name: 'Back to My Trips' }).click();
  await page.getByRole('link', { name: /Alps 2026/ }).click();
  await page.getByRole('button', { name: 'Back to My Trips' }).click();
  const trips = page.getByRole('main').getByRole('listitem');
  await expect(trips.nth(0)).toContainText('Lakes 2026');
  await expect(trips.nth(1)).toContainText('Alps 2026');
  await expect(trips.nth(1)).toContainText('Settled');
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

/** Renames an Expense from its row on the Expenses tab, and comes back to the tab. */
async function retitle(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('link').filter({ hasText: from }).click();
  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await page.getByLabel('Title').fill(to);
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByRole('heading', { name: to })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
}

test('two devices change the same Expenses; the one that syncs second keeps its own or theirs', async ({
  page,
  request,
  browser,
}) => {
  const link = await tripWithExpenses(
    request,
    'Hel 2026',
    ['Kasia', 'Ania'],
    [
      { title: 'Pizza', amount: 3000 },
      { title: 'Ferry', amount: 2000 },
    ],
  );
  await page.goto(link);
  await page.getByRole('dialog').getByRole('button', { name: 'Kasia' }).click();
  const ania = await browser.newContext();
  const other = await ania.newPage();
  await other.goto(link);
  await other.getByRole('dialog').getByRole('button', { name: 'Ania' }).click();
  await other.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Ania edits both offline while Kasia's edits of them reach the server first.
  await ania.setOffline(true);
  await retitle(other, 'Pizza', 'Pizza Napoli');
  await retitle(other, 'Ferry', 'Ferry Ania');
  await retitle(page, 'Pizza', 'Pizza Margherita');
  await retitle(page, 'Ferry', 'Ferry Kasia');
  await expect(page.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await ania.setOffline(false);

  const pizza = other.getByRole('link').filter({ hasText: 'Pizza Napoli' });
  await expect(pizza).toContainText('Conflict');
  await expect(other.getByRole('link').filter({ hasText: 'Ferry Ania' })).toContainText('Conflict');

  // An edit during the Conflict stays on Ania's version, which she then keeps.
  await pizza.click();
  const main = other.getByRole('main');
  await expect(main).toContainText('Kasia changed this Expense too.');
  await other.getByRole('link', { name: 'Edit Expense' }).click();
  await other.getByLabel('Title').fill('Pizza Napoli XL');
  await other.getByRole('button', { name: 'Save Expense' }).click();
  await other.getByRole('link', { name: 'Choose version' }).click();
  const mine = other.getByRole('region', { name: 'Your version' });
  const theirs = other.getByRole('region', { name: 'Their version' });
  await expect(mine).toContainText('Pizza Napoli XL');
  await expect(mine).toContainText('by Ania');
  await expect(theirs).toContainText('Pizza Margherita');
  await expect(theirs).toContainText('by Kasia');
  await other.getByRole('button', { name: 'Keep mine' }).click();
  await expect(other.getByRole('heading', { name: 'Pizza Napoli XL' })).toBeVisible();
  await expect(main).not.toContainText('Not synced');
  await other.getByRole('button', { name: 'Back' }).click();

  // For the Ferry she keeps Kasia's.
  await other.getByRole('link').filter({ hasText: 'Ferry Ania' }).click();
  await other.getByRole('link', { name: 'Choose version' }).click();
  await other.getByRole('button', { name: 'Keep theirs' }).click();
  await expect(other.getByRole('heading', { name: 'Ferry Kasia' })).toBeVisible();
  await expect(main).not.toContainText('Not synced');
  await other.getByRole('button', { name: 'Back' }).click();
  await expect(other.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await expect(other.getByRole('link').filter({ hasText: 'Conflict' })).toHaveCount(0);
  await ania.close();

  await page.reload();
  await expect(page.getByRole('link').filter({ hasText: 'Pizza Napoli XL' })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: 'Ferry Kasia' })).toBeVisible();
});

test('a change the server rejects says why, and can be discarded or fixed', async ({
  page,
  request,
}) => {
  await page.goto(await tripLinkFor(request, 'Rab 2026', ['Kasia', 'Ania']));
  await page.getByRole('dialog').getByRole('button', { name: 'Kasia' }).click();
  // Stands in for the Main payer leaving the Trip on another device before this one syncs:
  // the server gets a Main payer the Trip doesn't have.
  const push = '**/api/trips/*/push';
  await page.route(push, async (route) => {
    // SAFETY: the app only pushes requests `pushRequestSchema` accepts.
    const { changes } = route.request().postDataJSON() as PushRequest;
    const unknownPayer = changes.map((change) =>
      change.kind === 'expense'
        ? { ...change, expense: { ...change.expense, mainPayerId: uuidv7() } }
        : change,
    );
    await route.continue({ postData: JSON.stringify({ changes: unknownPayer }) });
  });
  const main = page.getByRole('main');
  const add = async (title: string) => {
    await page.getByRole('link', { name: /Add (the first )?Expense/ }).click();
    await page.getByLabel('Amount').fill('12');
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Save Expense' }).click();
    await page.getByRole('link').filter({ hasText: title }).click();
    await expect(main).toContainText('Not synced: who paid is no longer in the Trip.');
    await expect(main).toContainText('Edit it to fix it, or discard your change.');
  };

  // Discarded, a new Expense is gone.
  await add('Taxi');
  await page.getByRole('button', { name: 'Discard change' }).click();
  await expect(page.getByRole('link', { name: 'Add the first Expense' })).toBeVisible();

  // Fixed, it syncs.
  await add('Ferry');
  await page.unroute(push);
  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await page.getByLabel('Title').fill('Ferry Rab');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByRole('heading', { name: 'Ferry Rab' })).toBeVisible();
  await expect(main).not.toContainText('Not synced');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
});

test('delete an Expense, bring it back from Recently deleted, and restore an older version from its History', async ({
  page,
  request,
}) => {
  await page.goto(
    await tripWithExpenses(
      request,
      'Krk 2026',
      ['Kasia', 'Ania'],
      [{ title: 'Ferry', amount: 3000 }],
    ),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Kasia' }).click();
  const main = page.getByRole('main');
  const row = page.getByRole('link', { name: /Ferry/ });

  await row.click();
  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await page.getByLabel('Amount').fill('45');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(main).toContainText('Last edited by Kasia, now');

  // Deleted, it leaves the Expenses tab for Recently deleted.
  await page.getByRole('button', { name: 'Delete Expense' }).click();
  await expect(page.getByRole('link', { name: 'Add the first Expense' })).toBeVisible();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByRole('link', { name: 'Recently deleted' }).click();
  await expect(page.getByRole('heading', { name: 'Recently deleted' })).toBeVisible();
  await expect(main.getByRole('listitem')).toContainText('€45.00 · Deleted by Kasia');
  await page.getByRole('button', { name: 'Restore Ferry' }).click();
  await expect(main).toContainText('Nothing deleted');

  // Every change is a Revision; the first one opens in full and restores.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await row.click();
  await page.getByRole('link', { name: 'History' }).click();
  const revisions = main.getByRole('listitem');
  await expect(revisions).toHaveCount(4);
  await expect(revisions.nth(0)).toContainText('Restored');
  await expect(revisions.nth(1)).toContainText('Deleted');
  await expect(revisions.nth(2)).toContainText('€30.00 → €45.00');
  await expect(revisions.nth(3)).toContainText('Added');
  await revisions.nth(3).click();
  await expect(main).toContainText('€30.00');
  await page.getByRole('button', { name: 'Restore this Revision' }).click();

  await expect(page.getByRole('heading', { name: 'Ferry' })).toBeVisible();
  await expect(main).toContainText('€30.00');
});
