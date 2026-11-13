import { SYNC_SCHEMA_HEADER, SYNC_SCHEMA_VERSION, type PushRequest } from '@osi/owe-yeah-domain';
import type { Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import {
  createTrip,
  expect,
  test,
  tripLinkFor,
  tripLinkFromInvite,
  tripWithExpenses,
} from './fixtures';

// Journeys of working offline and syncing: changes made offline reaching another device, the
// sync status, Conflicts, changes the server rejects, and an outdated sync schema.

/**
 * Claims `name` from the open "Who are you?" sheet. WebKit then offers notifications (on an
 * iPhone with the Home Screen hint), which this turns down with "Not now"; headless Chromium
 * blocks notifications, so it offers none.
 */
async function claim(page: Page, name: string): Promise<void> {
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name }).click();
  if (page.context().browser()?.browserType().name() === 'webkit') {
    await sheet.getByRole('button', { name: 'Not now' }).click();
  }
  await expect(sheet).toBeHidden();
}

test('a Trip and an Expense made offline reach a second device once back online @webkit', async ({
  page,
  context,
  browser,
}) => {
  // Opened once online, the app installs its service worker and then works offline.
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);

  await page.getByRole('link', { name: 'New Trip' }).click();
  await page.getByLabel('Trip name').fill('Mazury 2026');
  await page.getByLabel('Your name').fill('Kasia');
  await page.getByLabel('Participant 2').fill('Ania');
  await page.getByRole('button', { name: 'Create Trip' }).click();
  const header = page.getByRole('banner');
  await expect(header).toContainText('You are Kasia');

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('59');
  await page.getByLabel('Title').fill('Ferry tickets');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  const row = page.getByRole('link', { name: /Ferry tickets/ });
  await expect(row).toContainText('not synced');
  // The Trip, Kasia, Ania and the Expense.
  await header.getByRole('button', { name: '4 changes not synced' }).click();
  await expect(header).toContainText("Will sync when you're online");
  await page.keyboard.press('Escape');

  await context.setOffline(false);
  await expect(header.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await expect(row).not.toContainText('not synced');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(await tripLinkFromInvite(page));
  await claim(otherPage, 'Ania');
  await expect(otherPage.getByRole('link', { name: /Ferry tickets/ })).toContainText(
    'Kasia paid · for all 2',
  );
  await other.close();
});

test('the sync status says when the server, not the connection, holds sync up', async ({
  page,
  context,
  request,
}) => {
  await page.goto(await tripLinkFor(request, 'Hel 2026', ['Kasia', 'Ania']));
  await page.getByRole('dialog').getByRole('button', { name: 'Kasia' }).click();
  const header = page.getByRole('banner');
  await expect(header.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // The server fails the pull of the Trip opened again, with nothing waiting on this device.
  const pull = (url: URL) => /^\/api\/trips\/[^/]+$/.test(url.pathname);
  await page.route(pull, (route) => route.fulfill({ status: 500 }));
  await page.reload();
  await header.getByRole('button', { name: 'Sync failed' }).click();
  await expect(header).toContainText("The server couldn't take your changes. Retrying.");
  await page.unroute(pull);

  // Offline, a new Expense waits on this device.
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('12');
  await page.getByLabel('Title').fill('Ferry');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await header.getByRole('button', { name: '1 change not synced' }).click();
  await expect(header).toContainText("Will sync when you're online");
  await expect(header).not.toContainText("The server couldn't take your changes.");
});

test('a Receipt entered offline at the till, Line item by Line item, reaches a second device @webkit', async ({
  page,
  context,
  browser,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Title').fill('Lidl Rovinj');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  const addLine = async (price: string, name: string, quantity = '1') => {
    await adding.getByLabel('New Line item unit price').fill(price);
    await adding.getByLabel('New Line item quantity').fill(quantity);
    await adding.getByLabel('New Line item name').fill(name);
    await adding.getByRole('button', { name: 'Add to Receipt' }).click();
  };
  const lines = page.getByRole('region', { name: 'Line items' }).getByRole('listitem');
  const line = (name: string) => lines.filter({ hasText: name }).first();

  // Six waters copy the bread's Even split, then go to Kasia and Ania by Units.
  await addLine('2,49', 'Bread');
  await addLine(',29', 'Water', '6');
  await expect(line('Water')).toContainText('6 × €0.29 · Even · for all 3');
  await line('Water').getByRole('button', { name: /Water/ }).click();
  await line('Water').getByRole('button', { name: 'Units' }).click();
  await expect(line('Water')).toContainText('6 of 6 units unassigned');
  await line('Water').getByLabel('Units for Kasia').fill('3');
  await line('Water').getByLabel('Units for Ania').fill('3');
  await line('Water').getByLabel('Units for Ania').blur();
  await expect(line('Water')).toContainText('6 of 6 units assigned');
  await expect(line('Water')).not.toContainText('unassigned');

  // After a Units split the next line starts Even across everyone; nobody had it yet.
  await addLine('0,89', 'Chocolate');
  await expect(line('Chocolate')).toContainText('Even · for all 3');
  await line('Chocolate')
    .getByRole('button', { name: /Chocolate/ })
    .click();
  await line('Chocolate').getByRole('button', { name: 'Clear', exact: true }).click();
  // An open line shows only its name and total; closed, it says how it is split.
  await line('Chocolate').getByRole('button', { name: 'Done' }).click();
  await expect(line('Chocolate')).toContainText('Even · nobody yet');
  // Reordered to match the paper Receipt.
  await line('Chocolate')
    .getByRole('button', { name: /Chocolate/ })
    .click();
  await line('Chocolate').getByRole('button', { name: 'Move up' }).click();
  await expect(lines).toHaveText([/Bread/, /Chocolate/, /Water/]);

  await expect(page.getByRole('status', { name: 'Receipt total' })).toHaveText('€5.12');
  await expect(page.getByRole('main')).toContainText('€0.89 unassigned · yours for now');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  const row = page.getByRole('link', { name: /Lidl Rovinj/ });
  await expect(row).toContainText('not synced');
  await expect(row).toContainText('1 item unassigned');
  await expect(row).toContainText('Kasia paid');

  await context.setOffline(false);
  await expect(row).not.toContainText('not synced');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(await tripLinkFromInvite(page));
  await claim(otherPage, 'Ania');
  const otherRow = otherPage.getByRole('link', { name: /Lidl Rovinj/ });
  // A third of the bread and three waters: 0.83 + 0.87.
  await expect(otherRow).toContainText('your share €1.70');
  await expect(otherRow).toContainText('1 item unassigned');
  await otherRow.click();
  const items = otherPage.getByRole('region', { name: 'Line items' }).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText('Chocolate');
  await expect(items.nth(2)).toContainText('6 × €0.29 · Units · Kasia 3, Ania 3');
  await other.close();
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

test('two devices change the same Expenses; the one that syncs second keeps its own or theirs @webkit', async ({
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
  await claim(page, 'Kasia');
  const ania = await browser.newContext();
  const other = await ania.newPage();
  await other.goto(link);
  await claim(other, 'Ania');
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

  // An edit during the Conflict stays on Ania's change, which she then keeps.
  await pizza.click();
  const main = other.getByRole('main');
  await expect(main).toContainText('Kasia changed this Expense too.');
  await other.getByRole('link', { name: 'Edit Expense' }).click();
  await other.getByLabel('Title').fill('Pizza Napoli XL');
  await other.getByRole('button', { name: 'Save Expense' }).click();
  await other.getByRole('link', { name: 'Choose a change' }).click();
  const mine = other.getByRole('region', { name: 'Your change' });
  const theirs = other.getByRole('region', { name: "Kasia's change" });
  await expect(mine).toContainText('Pizza Napoli XL');
  await expect(theirs).toContainText('Pizza Margherita');
  await expect(mine).toContainText("Kasia's change stays in History");
  await other.getByRole('button', { name: 'Keep yours' }).click();
  await expect(other.getByRole('heading', { name: 'Pizza Napoli XL' })).toBeVisible();
  await expect(main).not.toContainText('Not synced');
  await other.getByRole('button', { name: 'Back' }).click();

  // For the Ferry she keeps Kasia's.
  await other.getByRole('link').filter({ hasText: 'Ferry Ania' }).click();
  await other.getByRole('link', { name: 'Choose a change' }).click();
  await other.getByRole('button', { name: "Keep Kasia's" }).click();
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
    await page.getByRole('link', { name: 'Add Expense' }).click();
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
  await expect(page.getByRole('link', { name: 'Add Expense' })).toBeVisible();

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

test('an app a sync schema behind the server asks to reload, and its changes sync once it has', async ({
  page,
}) => {
  // Stands in for an app from before the server's newest sync schema.
  const api = '**/api/**';
  await page.route(api, (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        [SYNC_SCHEMA_HEADER]: String(SYNC_SCHEMA_VERSION - 1),
      },
    }),
  );
  await createTrip(page, 'Krk 2026', 'Kasia', ['Ania']);

  await expect(page.getByText('New version available', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Your changes wait on this device and sync once you reload.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '3 changes not synced' })).toBeVisible();

  // Reloaded, the app speaks the server's sync schema again.
  await page.unroute(api);
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await expect(page.getByText('New version available', { exact: true })).toHaveCount(0);
});
