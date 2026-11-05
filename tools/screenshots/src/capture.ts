// The app's screenshot set for design reviews (the council skill's design branch): seeds two
// Trips through the sync API of a running app, then captures 13 screens at phone size
// (390 px, 2x), light and dark, into `<outDir>/{light,dark}-NN-name.png`.
//
//   pnpm --filter @osi/owe-yeah-screenshots capture <outDir> [baseUrl=http://localhost:3000]
//
// Capture from a freshly started app: the dev server bundles icons only at startup, so an icon
// added since renders blank. The e2e build regenerates `.nuxt` under a running dev server, so
// restart it after `test:e2e:ui` too. Tall screens are full-page captures: the viewport grows
// to the page's height, so fixed bars sit at the bottom instead of mid-page.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
  SYNC_SCHEMA_HEADER,
  SYNC_SCHEMA_VERSION,
  TRIP_TOKEN_HEADER,
  type Expense,
  type ExpenseTime,
  type Participant,
  type PushRequest,
  type SyncChange,
} from '@osi/owe-yeah-domain';
import { chromium, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';

const [out, base = 'http://localhost:3000'] = process.argv.slice(2);
if (!out) throw new Error('Usage: capture <outDir> [baseUrl]');
mkdirSync(out, { recursive: true });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Split = Extract<Expense, { lineItems: unknown }>['lineItems'][number]['split'];

/** What a Trip's seed gets to build its Expenses from, by Participant name. */
type Seed<Name extends string> = {
  people: Record<Name, Participant>;
  at: (day: number, hour: number) => ExpenseTime;
  even: (who?: readonly Name[]) => Split;
  units: (parts: Partial<Record<Name, number>>) => Split;
  amounts: (parts: Partial<Record<Name, number>>) => Split;
  expense: (expense: DistributiveOmit<Expense, 'id' | 'currency'>) => SyncChange;
};

/** Creates a Trip in EUR as another device would, by its first push; returns its Trip link. */
async function push<const Name extends string>(
  tripName: string,
  names: readonly Name[],
  build: (seed: Seed<Name>) => SyncChange[],
): Promise<string> {
  const id = uuidv7();
  const token = randomBytes(32).toString('base64url');
  const meta = { claimId: null, deviceId: uuidv7() };
  // SAFETY: the loop right below gives every name its Participant before `people` is read.
  const people = {} as Record<Name, Participant>;
  for (const name of names) people[name] = { id: uuidv7(), name };
  // The named Participants' parts, in the Trip's order.
  const given = (parts: Partial<Record<Name, number>>) =>
    names.flatMap((name) => {
      const part = parts[name];
      return part === undefined ? [] : [{ participantId: people[name].id, part }];
    });
  const seed: Seed<Name> = {
    people,
    // July 2026, Croatian summer time.
    at: (day, hour) => ({
      instant: new Date(Date.UTC(2026, 6, day, hour - 2)).toISOString(),
      zone: 'Europe/Zagreb',
    }),
    even: (who = names) => ({ mode: 'even', participantIds: who.map((name) => people[name].id) }),
    units: (parts) => ({
      mode: 'units',
      parts: given(parts).map(({ participantId, part }) => ({ participantId, units: part })),
    }),
    amounts: (parts) => ({
      mode: 'amounts',
      parts: given(parts).map(({ participantId, part }) => ({ participantId, amount: part })),
    }),
    expense: (expense) => ({
      ...meta,
      id: uuidv7(),
      kind: 'expense',
      baseVersion: null,
      expense: { id: uuidv7(), currency: 'EUR', ...expense },
      deleted: false,
    }),
  };
  const body = {
    changes: [
      { ...meta, id: uuidv7(), kind: 'trip', trip: { name: tripName, currency: 'EUR' } },
      ...names.map((name) => ({
        ...meta,
        id: uuidv7(),
        kind: 'participant' as const,
        participant: people[name],
        removed: false,
      })),
      ...build(seed),
    ],
  } satisfies PushRequest;
  const response = await fetch(`${base}/api/trips/${id}/push`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TRIP_TOKEN_HEADER]: token,
      [SYNC_SCHEMA_HEADER]: String(SYNC_SCHEMA_VERSION),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`push ${response.status}: ${await response.text()}`);
  return `${base}/trips/${id}#${token}`;
}

const croatia = await push(
  'Croatia 2026',
  ['Ania', 'Kasia', 'Tomek', 'Marta'],
  ({ people, at, even, units, amounts, expense }) => [
    expense({
      title: 'Apartment in Split',
      time: at(3, 16),
      mainPayerId: people.Marta.id,
      lineItems: [{ name: '', unitPrice: 48000, quantity: 1, split: even() }],
    }),
    expense({
      title: 'Ferry to Hvar',
      time: at(4, 9),
      mainPayerId: people.Tomek.id,
      lineItems: [{ name: '', unitPrice: 9640, quantity: 1, split: even() }],
    }),
    // Every option a till Receipt can need: Units, Amounts and Even splits, a Line discount in
    // money and in percent, Deposits, a Deposit refund, a unit nobody took yet, and a Receipt
    // discount. Amounts stay whole cents, so no total shows "≈".
    expense({
      title: 'Konzum groceries',
      time: at(4, 18),
      mainPayerId: people.Kasia.id,
      discount: { kind: 'amount', amount: 190 },
      lineItems: [
        {
          name: 'Orange juice 1 l',
          unitPrice: 129,
          quantity: 6,
          depositPerUnit: 13,
          split: units({ Tomek: 3, Marta: 2, Ania: 1 }),
        },
        {
          name: 'Pršut, sliced',
          unitPrice: 899,
          quantity: 1,
          discount: { kind: 'amount', amount: 100 },
          split: even(['Ania', 'Kasia', 'Marta']),
        },
        {
          name: 'Jamnica water 1.5 l',
          unitPrice: 59,
          quantity: 6,
          depositPerUnit: 13,
          split: even(),
        },
        {
          name: 'Sunscreen SPF 50',
          unitPrice: 1450,
          quantity: 1,
          split: amounts({ Kasia: 1000, Marta: 450 }),
        },
        {
          name: 'Ledo ice cream',
          unitPrice: 149,
          quantity: 4,
          discount: { kind: 'percent', basisPoints: 2500 },
          split: units({ Ania: 1, Kasia: 1, Tomek: 1 }),
        },
        { name: 'Bottle return', unitPrice: -195, quantity: 1, split: even() },
      ],
    }),
    expense({
      title: 'Dinner at Konoba Fetivi',
      time: at(4, 21),
      mainPayerId: people.Ania.id,
      lineItems: [{ name: '', unitPrice: 15680, quantity: 1, split: even() }],
    }),
    expense({
      title: 'Kayak rental',
      time: at(5, 11),
      mainPayerId: people.Ania.id,
      lineItems: [{ name: '', unitPrice: 6000, quantity: 1, split: even(['Ania', 'Tomek']) }],
    }),
    expense({
      title: 'Gelato',
      time: at(5, 15),
      mainPayerId: people.Tomek.id,
      lineItems: [{ name: '', unitPrice: 1400, quantity: 1, split: even() }],
    }),
    expense({
      title: 'Repayment',
      time: at(5, 19),
      mainPayerId: people.Kasia.id,
      recipientId: people.Marta.id,
      amount: 5000,
    }),
  ],
);

// Settled: Piotr paid Ania back his half.
const tatry = await push('Tatry weekend', ['Ania', 'Piotr'], ({ people, at, even, expense }) => [
  expense({
    title: 'Mountain hut',
    time: at(1, 18),
    mainPayerId: people.Ania.id,
    lineItems: [{ name: '', unitPrice: 12000, quantity: 1, split: even() }],
  }),
  expense({
    title: 'Repayment',
    time: at(2, 10),
    mainPayerId: people.Piotr.id,
    recipientId: people.Ania.id,
    amount: 6000,
  }),
]);

const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch();

/** Captures the whole set in one colour scheme, on a fresh device that knows no Trips. */
async function capture(scheme: 'light' | 'dark'): Promise<void> {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
  });
  const page = await context.newPage();
  // The Nuxt devtools overlay isn't part of the app, and it takes clicks.
  const hideDevtools = (target: Page) =>
    target.evaluate(() =>
      document.querySelectorAll('[id^="nuxt-devtools"]').forEach((element) => element.remove()),
    );
  const go = async (url: string) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await hideDevtools(page);
  };
  const shot = async (name: string, fullPage = false) => {
    await page.waitForTimeout(700);
    await hideDevtools(page);
    if (fullPage) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: PHONE.width, height: Math.max(PHONE.height, height) });
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${out}/${scheme}-${name}.png` });
    if (fullPage) await page.setViewportSize(PHONE);
  };
  const tripPage = croatia.split('#')[0]!;
  const sheet = page.getByRole('dialog');

  await go(base);
  await page.getByText('New Trip').first().waitFor();
  await shot('01-my-trips-empty');

  await go(tatry);
  await sheet.getByRole('button', { name: 'Ania', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await go(croatia);
  await sheet.waitFor();
  await shot('02-who-are-you');
  await sheet.getByRole('button', { name: 'Ania', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await shot('03-expenses', true);

  await page.getByRole('link', { name: /Konzum groceries/ }).click();
  await page.waitForURL(/expenses\/[\w-]+$/);
  await shot('04-expense-detail', true);

  await go(`${page.url()}/edit`);
  const juice = page.getByRole('button', { name: /Orange juice/ });
  await juice.waitFor();
  await shot('10-receipt-form', true);
  await juice.click();
  await shot('11-receipt-line-open', true);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  await adding.getByLabel('New Line item name').fill('Tomatoes');
  await adding.getByLabel('New Line item unit price').fill('2.49');
  await adding.getByLabel('New Line item quantity').fill('2');
  // The stepper takes what is typed when it loses focus.
  await adding.getByLabel('New Line item quantity').press('Tab');
  await shot('13-receipt-adding', true);

  await go(`${tripPage}/balances`);
  await shot('05-balances', true);
  await go(`${tripPage}/settings`);
  await shot('06-trip-settings', true);
  await go(`${tripPage}/expenses/new`);
  await shot('07-new-expense', true);
  await page.getByLabel('Amount').fill('23.40');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  await shot('12-receipt-start', true);

  await go(base);
  await page.getByRole('link', { name: /Croatia 2026/ }).waitFor();
  await shot('08-my-trips');
  await go(`${base}/trips/new`);
  await shot('09-new-trip');
  await context.close();
}

await capture('light');
await capture('dark');
await browser.close();
console.log(`26 screenshots in ${out}`);
