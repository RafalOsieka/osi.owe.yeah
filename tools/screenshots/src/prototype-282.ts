// PROTOTYPE (#282), throwaway: seeds a Trip in PLN on a running app and captures the Photos and
// Drafts prototype's screens at 390 px, every variant.
//
//   pnpm --filter @osi/owe-yeah-screenshots exec node src/prototype-282.ts <outDir> [baseUrl]
//
// Prints the Trip link, to open on a phone.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
  SYNC_SCHEMA_HEADER,
  SYNC_SCHEMA_VERSION,
  TRIP_TOKEN_HEADER,
  type SyncChange,
} from '@osi/owe-yeah-domain';
import { chromium, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';

const [out, base = 'http://localhost:3282', only] = process.argv.slice(2);
if (!out) throw new Error('Usage: prototype-282 <outDir> [baseUrl] [seed-only]');
mkdirSync(out, { recursive: true });

const id = uuidv7();
const token = randomBytes(32).toString('base64url');
const deviceId = uuidv7();
const people = ['Ania', 'Piotr', 'Ola'].map((name) => ({ id: uuidv7(), name }));
const meta = () => ({ id: uuidv7(), claimId: people[0]!.id, deviceId });
const even = { mode: 'even' as const, participantIds: people.map(({ id }) => id) };
const at = (day: number, hour: number) => ({
  instant: new Date(Date.UTC(2026, 10, day, hour - 1)).toISOString(),
  zone: 'Europe/Warsaw',
});
const expense = (title: string, amount: number, payer: number, day: number, hour: number) => ({
  ...meta(),
  kind: 'expense' as const,
  baseVersion: null,
  deleted: false,
  expense: {
    id: uuidv7(),
    currency: 'PLN',
    title,
    mainPayerId: people[payer]!.id,
    time: at(day, hour),
    lineItems: [{ name: '', unitPrice: amount, quantity: 1, split: even }],
  },
});
const changes = [
  { ...meta(), kind: 'trip', trip: { name: 'Mazury 2026', currency: 'PLN' } },
  ...people.map((participant) => ({
    ...meta(),
    claimId: null,
    kind: 'participant' as const,
    participant,
    removed: false,
  })),
  expense('Fuel', 28_450, 1, 10, 9),
  expense('Pierogi at the harbour', 14_200, 2, 11, 19),
  expense('Boat rental', 60_000, 0, 12, 10),
] as SyncChange[];
const response = await fetch(`${base}/api/trips/${id}/push`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    [TRIP_TOKEN_HEADER]: token,
    [SYNC_SCHEMA_HEADER]: String(SYNC_SCHEMA_VERSION),
  },
  body: JSON.stringify({ changes }),
});
if (!response.ok) throw new Error(`push ${response.status}: ${await response.text()}`);
const page0 = `${base}/trips/${id}`;
console.log(`Trip link: ${page0}#${token}`);
if (only === 'seed-only') process.exit(0);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'Europe/Warsaw',
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror', error.message));
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning')
    console.log(message.type(), message.text().slice(0, 300));
});

const tidy = () =>
  page.evaluate(() =>
    document.querySelectorAll('[id^="nuxt-devtools"]').forEach((element) => element.remove()),
  );
async function shot(name: string, full = false): Promise<void> {
  await page.waitForTimeout(600);
  await tidy();
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
}
/** Picks this screen's variant, through the prototype's hook. */
async function variant(screen: string, key: string): Promise<void> {
  await page.evaluate(
    ([s, k]) =>
      (window as unknown as { protoVariant: (s: string, k: string) => void }).protoVariant(s!, k!),
    [screen, key],
  );
  await page.waitForTimeout(400);
}

await page.goto(`${page0}#${token}`);
await page.waitForLoadState('networkidle');
await tidy();
// Who are you: Ania.
const ania = page
  .getByRole('radio', { name: 'Ania' })
  .or(page.getByRole('button', { name: 'Ania' }));
if (
  await ania
    .first()
    .isVisible()
    .catch(() => false)
) {
  await ania.first().click();
  const confirm = page.getByRole('button', { name: /continue|that's me|confirm|done/i });
  if (
    await confirm
      .first()
      .isVisible()
      .catch(() => false)
  )
    await confirm.first().click();
}
await page.waitForTimeout(800);
await shot('00-landing');

for (const key of ['A', 'B', 'C']) {
  await variant('expenses', key);
  await shot(`10-expenses-${key}`);
}
await variant('expenses', 'B');
await page.getByRole('button', { name: 'Add', exact: true }).click();
await shot('11-expenses-B-chooser');
await page.keyboard.press('Escape');
await variant('expenses', 'C');
await page.getByText(/Drafts? to check/).click();
await shot('12-expenses-C-sheet');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// The newest Expense's detail page, with its seeded Photos.
await variant('expenses', 'A');
await page.getByText('Boat rental').first().click();
await page.waitForLoadState('networkidle');
await shot('20-detail', true);
await page.getByRole('button', { name: 'Photo 1' }).click();
await shot('21-viewer');
await page.getByRole('button', { name: 'Close' }).click();

// Its edit form, every Photos variant.
await page.goto(`${page.url().split('?')[0]}/edit`);
await page.waitForLoadState('networkidle');
for (const key of ['A', 'B', 'C']) {
  await variant('form', key);
  await shot(`30-form-${key}`, true);
}
await variant('form', 'A');
await page.getByRole('button', { name: 'Photo 2' }).click();
await page.getByRole('button', { name: 'Remove' }).click();
await shot('31-remove-confirm');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page
  .getByRole('button', { name: 'Close' })
  .click()
  .catch(() => {});

// The Drafts: ready (every variant), reading, couldn't read.
async function openDraft(state: RegExp): Promise<void> {
  await page.goto(page0);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.getByRole('link', { name: state }).first().click();
  await page.waitForURL(/drafts/);
  await page.waitForTimeout(800);
}
await openDraft(/Ready to check/);
for (const key of ['A', 'B', 'C']) {
  await variant('draft', key);
  await shot(`40-draft-${key}`);
  await shot(`40-draft-${key}-full`, true);
}
await variant('draft', 'C');
await page.getByRole('button', { name: 'Photo', exact: true }).click();
await shot('41-draft-C-photo', true);
await variant('draft', 'A');
await page.getByRole('button', { name: /Maslo extra.*Price hard/ }).click();
await page.waitForTimeout(800);
await shot('42-draft-A-line-open');

await openDraft(/Being read/);
await shot('50-draft-reading');
await openDraft(/Couldn't read/);
await shot('51-draft-failed');

await browser.close();
