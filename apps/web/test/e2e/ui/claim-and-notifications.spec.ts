import {
  pullResponseSchema,
  SYNC_SCHEMA_HEADER,
  SYNC_SCHEMA_VERSION,
  TRIP_TOKEN_HEADER,
} from '@osi/owe-yeah-domain';
import type { Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { expect, test, tripLinkFor, tripWithExpenses, type PushService } from './fixtures';

// Journeys of saying who you are on a Trip, opening it by its Trip link, and the
// Notifications and Reminders that follow a Claim.

/**
 * Stands in for the browser's notification permission and push subscription: headless Chromium
 * reports notifications blocked, and can't reach a push service. The browser subscribes at
 * `pushService` instead, with keys it can encrypt for. The permission is granted until
 * `setNotificationPermission` changes it, and lasts past a reload.
 */
async function standInForNotifications(page: Page, pushService: PushService): Promise<void> {
  const pushSubscription = pushService.subscription(uuidv7());
  await page.addInitScript((subscriptionJson) => {
    Object.defineProperty(Notification, 'permission', {
      get: () => localStorage.getItem('test-notification-permission') ?? 'granted',
    });
    Notification.requestPermission = async () => Notification.permission;
    const subscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: null, userVisibleOnly: true },
      toJSON: () => subscriptionJson,
      unsubscribe: async () => true,
    };
    // SAFETY: the app reads only these members of a PushSubscription.
    PushManager.prototype.subscribe = async () => subscription as PushSubscription;
    PushManager.prototype.getSubscription = async () => null;
  }, pushSubscription);
}

/** Allows or blocks notifications for the app, as the browser's site settings do. */
async function setNotificationPermission(
  page: Page,
  permission: NotificationPermission,
): Promise<void> {
  await page.evaluate(
    (value) => localStorage.setItem('test-notification-permission', value),
    permission,
  );
}

test('a new Trip lands on its empty Expenses tab, already knowing who you are', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'New Trip' }).click();
  await page.getByLabel('Trip name').fill('Croatia 2026');
  await page.getByLabel('Your name').fill('Ania');
  await page.getByLabel('Participant 2').fill('Kasia');
  await page.getByRole('button', { name: 'Create Trip' }).click();

  const header = page.getByRole('banner');
  await expect(header.getByRole('heading', { name: 'Croatia 2026' })).toBeVisible();
  await expect(header).toContainText('You are Ania · EUR');
  // The token is on the device now, not in the address bar.
  await expect(page).toHaveURL(/\/trips\/[\w-]+$/);
  // The empty state's Add Expense, not the floating one as well.
  await expect(page.getByRole('link', { name: 'Add Expense' })).toHaveCount(1);
  await expect(page.getByText('No Expenses yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Expenses' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Back from the Trip goes to My Trips, not to the finished form.
  await header.getByRole('button', { name: 'Back to My Trips' }).click();
  await expect(page).toHaveURL('/');
  const row = page.getByRole('link', { name: /Croatia 2026/ });
  await expect(row).toContainText('No Expenses yet');
  // The Claim stays on the device: reopened, the Trip still knows who you are.
  await row.click();
  await expect(header).toContainText('You are Ania · EUR');
});

test('joining with a Trip link keeps its token on the device', async ({
  page,
  request,
  browser,
}) => {
  // With an Expense, so My Trips has a balance to show, or asks who you are instead.
  const tripLink = await tripWithExpenses(
    request,
    'Tatry 2026',
    ['Kasia', 'Ania'],
    [{ title: 'Hut', amount: 2000 }],
  );
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

test('notifications are offered once after a Claim, and turned on and off from the Trip tab', async ({
  page,
  request,
  pushService,
}) => {
  await standInForNotifications(page, pushService);
  const tripLink = await tripLinkFor(request, 'Mazury 2026', ['Kasia', 'Ania']);
  await page.goto(tripLink);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const sheet = page.getByRole('dialog', { name: 'Who are you?' });
  await sheet.getByRole('button', { name: 'Just looking' }).click();

  // Without a Claim, the Trip tab asks who you are first; the Claim ends with the offer,
  // explained before the browser's prompt.
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByRole('button', { name: /Notifications\s*Pick who you are first/ }).click();
  await sheet.getByRole('button', { name: 'Kasia' }).click();
  const offer = page.getByRole('dialog', { name: 'Notifications' });
  await expect(offer).toContainText('Only for Mazury 2026, only on this device.');
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toBeHidden();

  // "Not now" is not asked again by itself, even for another Claim.
  await page.getByRole('button', { name: /Who you are/ }).click();
  await sheet.getByRole('button', { name: 'Ania' }).click();
  await expect(sheet).toBeHidden();

  // The toggle lives on the Trip tab: off, then turned on from its explanation, and off.
  const row = page.getByRole('link', { name: /Notifications/ });
  await expect(row).toContainText('Off');
  await row.click();
  await expect(page.getByRole('main')).toContainText('Get notified when someone else adds');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(row).toContainText('On');
  await row.click();
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(row).toContainText('Off');
});

test('notifications turned on say Blocked once the browser blocks them, and On again once allowed and checked', async ({
  page,
  request,
  pushService,
}) => {
  await standInForNotifications(page, pushService);
  const tripLink = await tripLinkFor(request, 'Mazury 2026', ['Kasia', 'Ania']);
  await page.goto(tripLink);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page
    .getByRole('dialog', { name: 'Who are you?' })
    .getByRole('button', { name: 'Kasia' })
    .click();
  await page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: 'Turn on' })
    .click();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  const row = page.getByRole('link', { name: /Notifications/ });
  await expect(row).toContainText('On');

  // Blocked in the browser's site settings afterwards: the row and the page say so, with the
  // steps to unblock, instead of "On".
  await setNotificationPermission(page, 'denied');
  await page.reload();
  await expect(row).toContainText('Blocked');
  await row.click();
  const main = page.getByRole('main');
  await expect(main).toContainText('Blocked in this browser');
  await expect(main).toContainText('To unblock them:');
  await expect(main).not.toContainText("You're notified about changes");

  // Allowed again: "Check again" brings them back, with no need to tap "Turn on".
  await setNotificationPermission(page, 'granted');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(row).toContainText('On');
});

test('Remind shares a message while the debtor cannot be notified, then sends one Reminder a day; a tapped one highlights its suggestion', async ({
  page,
  request,
  pushService,
}) => {
  // Kasia paid 24.50 for herself and Ania: Ania pays Kasia 12.25.
  const tripLink = await tripWithExpenses(
    request,
    'Hel 2026',
    ['Kasia', 'Ania'],
    [{ title: 'Lidl', amount: 2450 }],
  );
  // Its Participants' ids, from the Trip as the server has it.
  const { pathname: path, hash } = new URL(tripLink, 'http://localhost');
  const headers = {
    [TRIP_TOKEN_HEADER]: hash.slice(1),
    [SYNC_SCHEMA_HEADER]: String(SYNC_SCHEMA_VERSION),
  };
  const pulled = pullResponseSchema.parse(
    await (await request.get(`/api${path}`, { headers })).json(),
  );
  const { trip } = pulled;
  const [kasia, ania] = trip?.participants ?? [];
  if (!trip || !kasia || !ania) throw new Error('The Trip has no Kasia and Ania');
  const tripId = trip.id;

  await page.goto(tripLink);
  await page.getByRole('dialog').getByRole('button', { name: 'Kasia' }).click();
  await page.getByRole('link', { name: 'Balances' }).click();
  const toSettle = page.getByRole('region', { name: 'To settle' });
  const row = toSettle.getByRole('listitem');
  await expect(row).toContainText(/Ania → you\s*€12.25/);

  // No device of Ania's can be notified: the list says so once, and Remind shares a message.
  await expect(toSettle).toContainText("Ania can't get notifications, so Remind shares a message");
  await row.getByRole('button', { name: 'Remind Ania with a message you share' }).click();
  const shared = await page.evaluate(() => window.shared?.text);
  expect(shared).toBe(
    `Hi Ania, a quick reminder: you owe me €12.25 for Hel 2026.\n${new URL(tripLink, page.url()).href}`,
  );

  // Once her phone has notifications on, Remind notifies her, once a day.
  const aniasPhone = uuidv7();
  const subscribed = await request.put(`/api/trips/${tripId}/subscriptions/${aniasPhone}`, {
    headers,
    data: { ...pushService.subscription(aniasPhone), claimId: ania.id },
  });
  expect(subscribed.ok()).toBe(true);
  await page.reload();
  await expect(toSettle).not.toContainText("can't get notifications");
  await row.getByRole('button', { name: 'Remind Ania with a notification' }).click();
  await expect(page.getByText('Reminder sent to Ania', { exact: true })).toBeVisible();
  await expect
    .poll(() => pushService.payloadsOf(aniasPhone))
    .toEqual([
      {
        kind: 'reminder',
        tripId,
        tripName: 'Hel 2026',
        currency: 'EUR',
        from: { id: kasia.id, name: 'Kasia' },
        to: ania.id,
        amount: '12.25',
      },
    ]);
  await expect(row.getByRole('button', { name: 'Reminded today' })).toBeDisabled();
  await page.reload();
  await expect(row.getByRole('button', { name: 'Reminded today' })).toBeDisabled();

  // A tapped Reminder opens Balances with its suggestion marked, Record one tap away.
  await page.goto(`${path}/balances?payer=${ania.id}&recipient=${kasia.id}`);
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row.getByRole('link', { name: /Record Repayment/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}/balances$`));
});

test('a Trip link with a wrong token shows no Trip', async ({ page }) => {
  await page.goto('/trips/019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b#not-the-token');

  await expect(page.getByRole('heading', { name: "This Trip link doesn't work." })).toBeVisible();
});
