import { SYNC_SCHEMA_HEADER, SYNC_SCHEMA_VERSION, TRIP_TOKEN_HEADER } from '@osi/owe-yeah-domain';
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { startPushService } from '../harness/push-service';
import {
  change,
  creation,
  newToken,
  newTrip,
  participant,
  plainExpense,
} from '../harness/trip-builders';

export { expect };

/** The push-service stand-in a worker's journeys subscribe at (`test/e2e/harness`). */
export type PushService = Awaited<ReturnType<typeof startPushService>>;

declare global {
  interface Window {
    /** What the app last passed to the share sheet, which tests stand in for. */
    shared?: ShareData;
  }
}

/**
 * Playwright's `test` for the ui suite: a test fails when the Content Security Policy blocks
 * anything on its pages, which the browser only reports in the console. It watches the test's
 * own context and every context the test opens with `browser.newContext()`.
 *
 * The share sheet is the OS's: the test's page stands in for it, so each run sees one whatever
 * the host, and keeps what the app shared in `window.shared`.
 *
 * `pushService` is the worker's push-service stand-in. The servers send to any endpoint in this
 * suite, so it needs no port known in advance: a journey subscribes at it with real keys and
 * reads what the server sent each device.
 */
export const test = base.extend<
  { failOnCspViolation: undefined; shareSheet: undefined },
  { pushService: PushService }
>({
  failOnCspViolation: [
    async ({ browser, context }, use) => {
      const violations: string[] = [];
      const watch = (watched: BrowserContext) =>
        watched.on('console', (message) => {
          if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text());
        });
      watch(context);
      browser.on('context', watch);
      await use(undefined);
      browser.off('context', watch);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
  shareSheet: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        navigator.share = async (data) => {
          window.shared = data;
        };
      });
      await use(undefined);
    },
    { auto: true },
  ],
  pushService: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern.
    async ({}, use) => {
      const pushService = await startPushService();
      await use(pushService);
      await pushService.close();
    },
    { scope: 'worker' },
  ],
});

/**
 * Creates a Trip as someone else's device would, by its first push, with `expenses` Expenses
 * of `amount` minor units paid by the first Participant for everyone, one per day back from
 * 1 July 2026. Returns the Trip link.
 */
export async function tripWithExpenses(
  request: APIRequestContext,
  name: string,
  participants: readonly string[],
  expenses: readonly { title: string; amount: number }[] = [],
): Promise<string> {
  const trip = newTrip(
    name,
    participants.map((added) => participant(added)),
  );
  const token = newToken();
  const [payer] = trip.participants;
  const changes = [
    ...creation(trip),
    ...expenses.map(({ title, amount }, index) =>
      change({
        ...plainExpense(payer!, trip.participants, { title, unitPrice: amount }),
        time: {
          instant: new Date(Date.UTC(2026, 6, 1 - index, 10)).toISOString(),
          zone: 'Europe/Zagreb',
        },
      }),
    ),
  ];
  const pushed = await request.post(`/api/trips/${trip.id}/push`, {
    headers: { [TRIP_TOKEN_HEADER]: token, [SYNC_SCHEMA_HEADER]: String(SYNC_SCHEMA_VERSION) },
    data: { changes },
  });
  expect(pushed.ok()).toBe(true);
  return `/trips/${trip.id}#${token}`;
}

/** Creates a Trip as someone else's device would, and returns its Trip link. */
export function tripLinkFor(
  request: APIRequestContext,
  name: string,
  participants: readonly string[],
): Promise<string> {
  return tripWithExpenses(request, name, participants);
}

/** The open Trip's Trip link, shared from Invite in the Trip header. */
export async function tripLinkFromInvite(page: Page): Promise<string> {
  await page.getByRole('banner').getByRole('button', { name: 'Invite' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Share the Trip link' }).click();
  const url = await page.evaluate(() => window.shared?.url);
  await page.keyboard.press('Escape');
  if (!url) throw new Error('Invite shared no Trip link');
  return url;
}

/** Creates a Trip through New Trip, as `me`, and lands on it. */
export async function createTrip(
  page: Page,
  name: string,
  me: string,
  others: readonly string[],
): Promise<void> {
  await page.goto('/trips/new');
  await page.getByLabel('Trip name').fill(name);
  await page.getByLabel('Your name').fill(me);
  for (const [index, other] of others.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Add another' }).click();
    await page.getByLabel(`Participant ${index + 2}`).fill(other);
  }
  await page.getByRole('button', { name: 'Create Trip' }).click();
  await expect(page.getByRole('banner')).toContainText(`You are ${me}`);
}
