import { createTrip, expect, test, tripLinkFor, tripWithExpenses } from './fixtures';

// Journeys around a Trip's tabs, the Trip tab above all: Participants, its name, Invite,
// forgetting it, and how the tabs keep their place and fit a phone.

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
  await expect(page.getByRole('region', { name: 'Everyone' })).toContainText('+€61,728.39');
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await expect(page.getByText(names[1]!, { exact: true })).toBeVisible();
  expect(await scrollsSideways()).toBe(false);

  await page.getByRole('banner').getByRole('button', { name: 'Back to My Trips' }).click();
  await expect(page.getByRole('link', { name: tripName.slice(0, 20) })).toBeVisible();
  expect(await scrollsSideways()).toBe(false);
});

test('forgetting a Trip is blocked while its changes have not synced, unless you lose them', async ({
  page,
  context,
}) => {
  // Opened once online, the app installs its service worker and then works offline.
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await createTrip(page, 'Hel 2026', 'Kasia', ['Ania']);
  await page.getByRole('link', { name: 'Trip', exact: true }).click();

  // The Trip, Kasia and Ania have not reached the server yet.
  await page.getByRole('button', { name: 'Forget this Trip' }).click();
  const dialog = page.getByRole('dialog', { name: 'Forget this Trip' });
  await expect(dialog).toContainText("3 changes on this device haven't synced yet.");
  await expect(dialog).toContainText("you'll need its Trip link");
  await expect(dialog.getByRole('button', { name: 'Forget', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Forget and lose 3 changes' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep Trip' }).click();

  // Once synced, it can be forgotten; the Trip stays on the server for the others.
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await page.getByRole('button', { name: 'Forget this Trip' }).click();
  await dialog.getByRole('button', { name: 'Forget', exact: true }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: /Hel 2026/ })).toHaveCount(0);
});

test('Invite waits until the Trip has synced, then passes on its Trip link by QR code, share sheet or copy', async ({
  page,
  context,
  browser,
}) => {
  // Opened once online, the app installs its service worker and then works offline.
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await createTrip(page, 'Krk 2026', 'Ania', ['Kasia']);

  // Until the server has the Trip, its link would open nothing.
  await page.getByRole('main').getByRole('button', { name: 'Invite' }).click();
  const sheet = page.getByRole('dialog', { name: 'Invite to Krk 2026' });
  await expect(sheet).toContainText("The Trip hasn't synced yet");
  await expect(sheet.getByRole('img', { name: 'QR code of the Trip link' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Share the Trip link' })).toHaveCount(0);

  // It syncs while the sheet is open; the QR code is made on this device.
  await context.setOffline(false);
  await expect(sheet.getByRole('img', { name: 'QR code of the Trip link' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Share the Trip link' }).click();
  const shared = await page.evaluate(() => window.shared);
  expect(shared?.title).toBe('Krk 2026');
  expect(shared?.url).toMatch(/^http:\/\/localhost:\d+\/trips\/[\w-]+#[\w-]{43}$/);
  await page.keyboard.press('Escape');

  // The Trip tab offers it too, and without signal: the QR code needs none. Without a share
  // sheet, the link is copied instead.
  await context.setOffline(true);
  await page.addInitScript(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(Navigator.prototype, 'share');
  });
  await page.reload();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Invite' }).click();
  await expect(sheet.getByRole('img', { name: 'QR code of the Trip link' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Copy the Trip link' }).click();
  await expect(page.getByText('Trip link copied', { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(shared?.url);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(copied);
  await expect(otherPage.getByRole('dialog')).toContainText('Who are you?');
  await other.close();
});

test('a Participant on an Expense is not removed, one on none is; and the Trip is renamed', async ({
  page,
  request,
}) => {
  await page.goto(
    await tripWithExpenses(
      request,
      'Rügen 2026',
      ['Kasia', 'Ania'],
      [{ title: 'Ferry', amount: 3000 }],
    ),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Kasia' }).click();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  const participants = page.getByRole('region', { name: 'Participants' });

  await participants.getByRole('button', { name: 'Ania' }).click();
  const ania = page.getByRole('dialog', { name: 'Ania' });
  await expect(ania).toContainText('On 1 Expense');
  await expect(ania).toContainText("they can't be removed");
  await expect(ania.getByRole('button', { name: 'Remove from Trip' })).toHaveCount(0);
  await ania.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Add Participant' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Ola');
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  await participants.getByRole('button', { name: 'Ola' }).click();
  await page
    .getByRole('dialog', { name: 'Ola' })
    .getByRole('button', { name: 'Remove from Trip' })
    .click();
  await expect(participants.getByRole('listitem')).toHaveCount(2);
  await expect(participants.getByRole('button', { name: 'Ola' })).toHaveCount(0);

  // The name changes, last write wins.
  await page.getByRole('link', { name: /Name and Trip currency/ }).click();
  await page.getByLabel('Name').fill('Rügen 2027');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: /Name and Trip currency/ })).toContainText(
    'Rügen 2027 · EUR',
  );
  await expect(page.getByRole('banner')).toContainText('Rügen 2027');
  await page.getByRole('link', { name: /Name and Trip currency/ }).click();
  await expect(page.getByRole('main')).toContainText('Last changed by you');
});

test('a Participant on Expenses, one on none and the device’s own are renamed from the Trip tab', async ({
  page,
  request,
}) => {
  await page.goto(
    await tripWithExpenses(
      request,
      'Hel 2026',
      ['Kasia', 'Ania', 'Ola'],
      [{ title: 'Ferry', amount: 3000 }],
    ),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Ania' }).click();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  const participants = page.getByRole('region', { name: 'Participants' });

  /** Opens `name`'s sheet and saves `typed` as their name. */
  async function rename(name: string, typed: string): Promise<void> {
    await participants.getByRole('button', { name }).click();
    const sheet = page.getByRole('dialog', { name });
    await expect(sheet.getByLabel('Name')).toHaveValue(name);
    await sheet.getByLabel('Name').fill(typed);
    await sheet.getByRole('button', { name: 'Save name' }).click();
    await expect(sheet).toHaveCount(0);
  }

  // Kasia paid for the Ferry: her new name shows on the Expense list, its details and Balances.
  await rename('Kasia', 'Katarzyna');
  await expect(participants.getByRole('button', { name: 'Katarzyna' })).toBeVisible();
  await page.getByRole('link', { name: 'Expenses' }).click();
  const ferry = page.getByRole('link', { name: /Ferry/ });
  await expect(ferry).toContainText('Katarzyna paid');
  await ferry.click();
  await expect(page.getByRole('main')).toContainText('Katarzyna');
  await expect(page.getByRole('main')).not.toContainText('Kasia');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('region', { name: 'To settle' })).toContainText('Katarzyna');
  await page.getByRole('link', { name: 'Trip', exact: true }).click();

  // Ola is on no Expense; Ania is this device's Claim, which follows her new name.
  await rename('Ola', 'Olga');
  await expect(participants.getByRole('button', { name: 'Olga' })).toBeVisible();
  await rename('Ania', 'Anna');
  await expect(page.getByRole('button', { name: /Who you are/ })).toContainText('Anna');

  // A blank name can't be saved, nor one over 50 characters, as when adding.
  await participants.getByRole('button', { name: 'Anna' }).click();
  const anna = page.getByRole('dialog', { name: 'Anna' });
  await anna.getByLabel('Name').fill('  ');
  await expect(anna.getByRole('button', { name: 'Save name' })).toBeDisabled();
  await anna.getByLabel('Name').fill('A'.repeat(51));
  await anna.getByRole('button', { name: 'Save name' }).click();
  await expect(anna).toContainText('Give the Participant a name of up to 50 characters.');
});
