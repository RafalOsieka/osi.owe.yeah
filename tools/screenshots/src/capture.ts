// The app's screenshot set for design reviews (the council skill's design branch): seeds three
// Trips through the sync API of a running app, then walks every page and its options at phone
// size (390 px, 2x), light and dark, into `<outDir>/{light,dark}-<id>.png`, with
// `<outDir>/screens.json` saying what each screen shows and in which themes (`SCREENS`). 72
// screens walked, 43 captured (12 of them in dark too), in three review groups: a (the app, the Trip tabs and Trip settings), b (an Expense's detail, its History and
// Conflict) and c (the Expense, Receipt and Repayment forms).
//
//   pnpm --filter @osi/owe-yeah-screenshots capture <outDir> [baseUrl=http://localhost:3000]
//
// Capture from a freshly started app: the dev server bundles icons only at startup, so an icon
// added since renders blank. The e2e build regenerates `.nuxt` under a running dev server, so
// restart it after `test:e2e:ui` too. Tall screens are full-page captures: the viewport grows
// to the page's height, so fixed bars sit at the bottom instead of mid-page. Sheets, menus and
// modals are captured open, at phone height.
//
// Each colour scheme seeds its own Trips, so both walk the same data: the walk edits and deletes
// Expenses, and makes a Conflict. "Offline" is the server being unreachable (`/api` aborted):
// the dev server has no service worker to load pages offline. Another device's changes are
// pushed through the sync API, as that device would.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  SYNC_SCHEMA_HEADER,
  SYNC_SCHEMA_VERSION,
  TRIP_TOKEN_HEADER,
  pushResponseSchema,
  type Expense,
  type ExpenseTime,
  type Participant,
  type SyncChange,
} from '@osi/owe-yeah-domain';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';

const [out, base = 'http://localhost:3000'] = process.argv.slice(2);
if (!out) throw new Error('Usage: capture <outDir> [baseUrl]');
mkdirSync(out, { recursive: true });

/**
 * Which colour schemes a screen is captured in. The walk passes every screen, but the set keeps
 * near-duplicates out (`none`: another screen already shows what they would), and takes dark
 * only for the core screens, where the dark theme shows everything it does differently.
 */
const SHOTS = { both: ['light', 'dark'], light: ['light'], none: [] } as const;
type Shots = keyof typeof SHOTS;

/** Every screen the walk passes, in review order within its group: [title, what it shows, shots]. */
const SCREENS = {
  'a01-my-trips-empty': [
    'My Trips, first visit',
    'The welcome a device with no Trips gets: what the app does and New Trip.',
    'both',
  ],
  'a02-new-trip': [
    'New Trip',
    'The New Trip form as it opens: name, Trip currency, your name and who else is coming.',
    'none',
  ],
  'a03-new-trip-filled': [
    'New Trip, filled in',
    'New Trip with a name, your name and three more Participants typed in, one field each.',
    'light',
  ],
  'a04-new-trip-currency': [
    'New Trip, Trip currency picker',
    'The Trip currency picker open on New Trip, the searchable list of currencies.',
    'none',
  ],
  'a05-invite-not-synced': [
    'Invite before the Trip synced',
    'Invite on a Trip just created without a connection: it explains the Trip link works once the Trip reaches the server.',
    'none',
  ],
  'a06-who-are-you': [
    'Who are you?',
    'The sheet a Trip link opens with the first time: pick your name, "Add me" if missing, or Just looking.',
    'both',
  ],
  'a07-notifications-offer': [
    'Notifications offer after a Claim',
    'The same sheet once a name is picked: the one-time offer of notifications for this Trip, and Turn on or Not now.',
    'none',
  ],
  'a08-notifications-offer-iphone': [
    'Notifications offer on iPhone',
    'The offer on iPhone Safari outside the installed app: it says to add the app to the Home Screen first.',
    'none',
  ],
  'a09-my-trips': [
    'My Trips',
    'My Trips with three Trips: one with a balance, one without Expenses yet, and a Settled one below.',
    'both',
  ],
  'a10-my-trips-install-nudge': [
    'My Trips with the install nudge',
    'My Trips on iPhone Safari: the dismissible nudge to add the app to the Home Screen above the Trips.',
    'light',
  ],
  'a11-app-menu': [
    'App menu',
    'The ⋯ menu of My Trips open: the color mode (System, Light, Dark).',
    'light',
  ],
  'a12-expenses': [
    'Expenses tab',
    "A Trip's Expenses by day: plain Expenses, a Receipt, Income and a Repayment, with what each means for you, and + Expense.",
    'both',
  ],
  'a13-expenses-just-looking': [
    'Expenses tab, just looking',
    'The Expenses tab on a device that picked no name ("Just looking"): rows without "your share" and the header asking Who are you?',
    'none',
  ],
  'a14-expenses-empty': [
    'Expenses tab, no Expenses yet',
    'A Trip without Expenses: the empty state offering the first Expense and Invite.',
    'light',
  ],
  'a15-sync-status': [
    'Sync status, synced',
    'The cloud in the Trip header tapped: "Everything is synced."',
    'none',
  ],
  'a16-sync-unsynced': [
    'Sync status, not synced',
    'An Expense edited without a connection: the header cloud marked, its popover saying 1 change is not synced, and the row marked.',
    'light',
  ],
  'a17-trip-notice': [
    'Notice from sync',
    'A removal another device made impossible: the notice on top of the Trip tabs that the Participant was not removed.',
    'light',
  ],
  'a18-invite': [
    'Invite',
    'The Invite sheet: the Trip link as a QR code to scan, and Share the Trip link.',
    'both',
  ],
  'a19-balances': [
    'Balances, you owe',
    "Balances for someone who owes: their balance card with what to settle, everyone's bars, the other Suggested Repayments.",
    'both',
  ],
  'a20-balances-breakdown': [
    'Balances, share breakdown',
    "A bar on Balances tapped: where that Participant's share comes from, what they paid and their balance.",
    'light',
  ],
  'a21-who-are-you-change': [
    'Who are you?, changing',
    'The Who are you? sheet opened from the Trip header with a name already picked: the current one marked, and Cancel.',
    'none',
  ],
  'a22-balances-owed': [
    'Balances, you are owed',
    "Balances for someone who is owed: the card says so, and each debtor has Remind (by a shared message, as they can't be notified).",
    'light',
  ],
  'a23-balances-settled': [
    'Balances, Settled',
    'A Settled Trip: "All settled" instead of the balance and suggestions, the bars all at zero.',
    'light',
  ],
  'a24-trip-tab': [
    'Trip tab',
    'The Trip tab: Participants with Add Participant and Invite, who you are and notifications, name and Trip currency, Recently deleted, Forget.',
    'both',
  ],
  'a25-add-participant': [
    'Add Participant',
    'The Add Participant sheet with a name typed in.',
    'light',
  ],
  'a26-participant-on-expenses': [
    'Participant on Expenses',
    "A Participant tapped who is on Expenses: the sheet says they can't be removed.",
    'light',
  ],
  'a27-participant-removable': [
    'Participant on no Expense',
    'A Participant tapped who is on no Expense: the sheet offers Remove from Trip.',
    'none',
  ],
  'a28-forget-trip': [
    'Forget this Trip',
    'The Forget this Trip confirmation, everything synced.',
    'none',
  ],
  'a29-forget-trip-unsynced': [
    'Forget this Trip, unsynced changes',
    "The Forget this Trip confirmation while a change hasn't synced: the warning, and Forget and lose 1 change.",
    'light',
  ],
  'a30-who-are-you-removed': [
    'Who are you?, after being removed',
    'Someone else removed the Participant this device was: the sheet says so and asks again.',
    'none',
  ],
  'a31-trip-details': [
    'Name and Trip currency',
    "The Trip's name and Trip currency form, with who last changed them.",
    'light',
  ],
  'a32-recently-deleted': [
    'Recently deleted',
    'Deleted Expenses, newest first, with who deleted them and Restore.',
    'light',
  ],
  'a33-notifications-pick-first': [
    'Notifications, no name picked',
    'The Notifications page on a device that picked no name: pick who you are first.',
    'none',
  ],
  'a34-notifications-off': [
    'Notifications, off',
    'The Notifications page while off: what they tell, and Turn on.',
    'light',
  ],
  'a35-notifications-failed': [
    'Notifications, turning on failed',
    "Turn on tapped where the server can't subscribe the device: the error under the explanation.",
    'none',
  ],
  'a36-notifications-blocked': [
    'Notifications, blocked',
    'The Notifications page where the browser blocks notifications: the steps to unblock them.',
    'light',
  ],
  'a37-notifications-home-screen': [
    'Notifications on iPhone',
    'The Notifications page on iPhone Safari outside the installed app: add it to the Home Screen first.',
    'none',
  ],
  'a38-privacy': ['Privacy notice', 'The privacy notice, in full.', 'light'],
  'a39-terms': ['Terms of service', 'The terms of service, in full.', 'none'],
  'a40-not-found': [
    'Page not found',
    'An address no page has: the page does not exist, with My Trips.',
    'light',
  ],
  'b01-expense-detail': [
    'Expense detail',
    'A plain Expense: total, when, the Main payer with a Contribution from someone else, the shares, who last edited it, History and Delete.',
    'both',
  ],
  'b02-receipt-detail': [
    'Receipt detail',
    'A Receipt: Line items with Units, Even and Amounts splits, Line discounts, Deposits, a Deposit refund, a unit nobody took, a Receipt discount, and the shares.',
    'both',
  ],
  'b03-share-breakdown': [
    'Share breakdown',
    'A share on the Receipt tapped: where it comes from (goods, discounts, Deposits, refunds), rounded parts explained.',
    'light',
  ],
  'b04-income-detail': [
    'Income detail',
    'Income: money received back for the group, who received it and how it is shared.',
    'none',
  ],
  'b05-repayment-detail': [
    'Repayment detail',
    'A Repayment: who paid whom, how much and when.',
    'light',
  ],
  'b06-history': [
    'History',
    "An Expense's History: its Revisions newest first, who made each and the total before → after.",
    'light',
  ],
  'b07-history-revision': [
    'History, one Revision',
    'An older Revision in full, with who made it and Restore this Revision.',
    'light',
  ],
  'b08-deleted-undo': [
    'Expense deleted, Undo',
    'Delete Expense tapped (it asks no confirmation): back on the Expenses tab with the toast offering Undo.',
    'none',
  ],
  'b09-expense-not-synced': [
    'Expense not synced yet',
    'An Expense edited without a connection: the notice on its detail that the others see it after the next sync.',
    'none',
  ],
  'b10-expenses-conflict': [
    'Expenses tab with a Conflict',
    'Back online after someone else changed the same Expense: its row marked Conflict.',
    'none',
  ],
  'b11-expense-conflict': [
    'Expense in Conflict',
    'The detail of the Expense in Conflict: the notice naming who changed it too, and Choose version.',
    'light',
  ],
  'b12-conflict': [
    'Conflict',
    'The Conflict screen: your version and theirs side by side, each with its own Keep button and what it does.',
    'light',
  ],
  'c01-new-expense': [
    'New Expense',
    'The New Expense form as it opens: amount with the currency pill, title, Paid by, Contributions, For whom, When, Money received and Itemise.',
    'both',
  ],
  'c02-new-expense-errors': [
    'New Expense, errors',
    'Save tapped on the empty form: what is missing, at each field.',
    'light',
  ],
  'c03-new-expense-filled': [
    'New Expense, filled in',
    'Amount, title, someone else as Main payer, and For whom without one Participant.',
    'none',
  ],
  'c04-new-expense-contribution': [
    'New Expense with a Contribution',
    "Add a Contribution used: a Participant's fixed amount, and what the Main payer pays of the rest.",
    'light',
  ],
  'c05-new-expense-currency-picker': [
    'New Expense, currency picker',
    'The currency pill under the amount open: the searchable list of every currency.',
    'none',
  ],
  'c06-new-expense-foreign-currency': [
    'New Expense in another currency',
    'The Expense in HUF with no automatic rate yet: the Manual rate field, filled as the amount charged in EUR, and the total in EUR.',
    'light',
  ],
  'c07-new-expense-when': [
    'New Expense, When open',
    'The When chip tapped: the date and time field with the time zone picker under it.',
    'light',
  ],
  'c08-new-income': [
    'New Income',
    'Money received switched on: the form becomes New Income, Received by, without Contributions or Itemise.',
    'none',
  ],
  'c09-edit-expense': [
    'Edit Expense',
    'A plain Expense with a Contribution, open in the Expense form.',
    'none',
  ],
  'c10-receipt-start': [
    'Receipt, just itemised',
    'Itemise as a Receipt tapped after typing an amount: the amount is the first Line item, open to edit.',
    'none',
  ],
  'c11-receipt-form': [
    'Receipt form',
    'A Receipt open in the Expense form: the Receipt total, the Till list with every line folded, the add rows and the Receipt discount.',
    'both',
  ],
  'c12-receipt-line-units': [
    'Receipt line, Units',
    'A line open with a Units split, its Line discount and Deposit section open as the line has a Deposit.',
    'both',
  ],
  'c13-receipt-line-amounts': [
    'Receipt line, Amounts',
    'A line open with an Amounts split, its Line discount and Deposit section folded.',
    'none',
  ],
  'c14-receipt-line-extras': [
    'Receipt line, discount and Deposit',
    'The same line with its Line discount and Deposit section opened, empty.',
    'light',
  ],
  'c15-receipt-line-even': [
    'Receipt line, Even',
    'A line open with an Even split and a Line discount.',
    'none',
  ],
  'c16-receipt-adding': [
    'Receipt, adding a Line item',
    'Add a Line item open, with a name, unit price and quantity typed in, before Add.',
    'light',
  ],
  'c17-receipt-refund': [
    'Receipt, adding a Deposit refund',
    'Add a Deposit refund open, with an amount typed in, before Add.',
    'none',
  ],
  'c18-repayment-suggested': [
    'Repayment from a suggestion',
    'Record tapped on a Suggested Repayment: the Repayment form filled with it.',
    'light',
  ],
  'c19-repayment-new': [
    'New Repayment',
    'Record another Repayment: the Repayment form with only who paid filled in.',
    'none',
  ],
  'c20-edit-repayment': ['Edit Repayment', 'A Repayment open in the Repayment form.', 'none'],
} as const satisfies Record<
  `${'a' | 'b' | 'c'}${number}-${string}`,
  readonly [string, string, Shots]
>;

type ScreenId = keyof typeof SCREENS;

writeFileSync(
  `${out}/screens.json`,
  `${JSON.stringify(
    Object.entries(SCREENS)
      .filter(([, [, , shots]]) => shots !== 'none')
      .map(([id, [title, about, shots]]) => ({
        id,
        group: id[0],
        title,
        about,
        themes: SHOTS[shots],
      })),
    null,
    2,
  )}\n`,
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Split = Extract<Expense, { lineItems: unknown }>['lineItems'][number]['split'];
/** An Expense as a seed writes it: its id and currency (EUR) are filled in. */
type NewExpense = DistributiveOmit<Expense, 'id' | 'currency'>;

/** What a Trip's seed gets to build its Expenses from, by Participant name. */
type Seed<Name extends string> = {
  people: Record<Name, Participant>;
  at: (day: number, hour: number) => ExpenseTime;
  even: (who?: readonly Name[]) => Split;
  units: (parts: Partial<Record<Name, number>>) => Split;
  amounts: (parts: Partial<Record<Name, number>>) => Split;
};

/** A Trip on the server, and another device's hand on it: changes pushed as that device. */
type Remote<Name extends string> = {
  /** The Trip link, with its token. */
  link: string;
  /** The Trip's page, without the token. */
  page: string;
  people: Record<Name, Participant>;
  /** An Expense's detail page, by its seeded title. */
  expensePage: (title: string) => string;
  /** Adds an Expense, entered by `by`. */
  add: (by: Name, expense: NewExpense) => Promise<void>;
  /** Changes the Expense with the seeded `title`, on top of its current version. */
  edit: (title: string, by: Name, change: (expense: Expense) => Expense) => Promise<void>;
  /** Deletes the Expense with the seeded `title`. */
  remove: (title: string, by: Name) => Promise<void>;
  /** Removes a Participant from the Trip. */
  removeParticipant: (name: Name, by: Name) => Promise<void>;
};

/**
 * Creates a Trip in EUR as another device would, by its first push: `names` are its
 * Participants, and `build` its Expenses, each entered by its Main payer.
 */
async function seed<const Name extends string>(
  tripName: string,
  names: readonly Name[],
  build: (seed: Seed<Name>) => NewExpense[] = () => [],
): Promise<Remote<Name>> {
  const id = uuidv7();
  const token = randomBytes(32).toString('base64url');
  const deviceId = uuidv7();
  // SAFETY: the loop right below gives every name its Participant before `people` is read.
  const people = {} as Record<Name, Participant>;
  for (const name of names) people[name] = { id: uuidv7(), name };
  // The named Participants' parts, in the Trip's order.
  const given = (parts: Partial<Record<Name, number>>) =>
    names.flatMap((name) => {
      const part = parts[name];
      return part === undefined ? [] : [{ participantId: people[name].id, part }];
    });
  const tools: Seed<Name> = {
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
  };

  // Each Expense by its seeded title, as the server has it now.
  const stored = new Map<string, { expense: Expense; version: number }>();
  const meta = (claimId: string | null) => ({ id: uuidv7(), claimId, deviceId });
  const expenseChange = (
    claimId: string,
    expense: Expense,
    baseVersion: number | null,
    deleted = false,
  ): SyncChange => ({ ...meta(claimId), kind: 'expense', baseVersion, expense, deleted });

  /** Pushes `changes`, all of which must be accepted, and keeps the Expenses' versions. */
  async function send(changes: SyncChange[]): Promise<void> {
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
    const { results } = pushResponseSchema.parse(await response.json());
    for (const [index, result] of results.entries()) {
      const change = changes[index]!;
      if (result.status !== 'accepted') {
        throw new Error(`${change.kind} change ${result.status}: ${JSON.stringify(result)}`);
      }
      if (change.kind !== 'expense' || result.version === null) continue;
      const key =
        [...stored].find(([, { expense }]) => expense.id === change.expense.id)?.[0] ??
        change.expense.title;
      stored.set(key, { expense: change.expense, version: result.version });
    }
  }

  const created = (expense: NewExpense): Expense => ({ id: uuidv7(), currency: 'EUR', ...expense });
  const found = (title: string) => {
    const known = stored.get(title);
    if (!known) throw new Error(`No Expense "${title}" in ${tripName}`);
    return known;
  };

  const [first] = names;
  await send([
    {
      ...meta(first ? people[first].id : null),
      kind: 'trip',
      trip: { name: tripName, currency: 'EUR' },
    },
    ...names.map((name) => ({
      ...meta(null),
      kind: 'participant' as const,
      participant: people[name],
      removed: false,
    })),
    ...build(tools).map((expense) => expenseChange(expense.mainPayerId, created(expense), null)),
  ]);

  const page = `${base}/trips/${id}`;
  return {
    link: `${page}#${token}`,
    page,
    people,
    expensePage: (title) => `${page}/expenses/${found(title).expense.id}`,
    add: (by, expense) => send([expenseChange(people[by].id, created(expense), null)]),
    edit: (title, by, change) => {
      const { expense, version } = found(title);
      return send([expenseChange(people[by].id, change(expense), version)]);
    },
    remove: (title, by) => {
      const { expense, version } = found(title);
      return send([expenseChange(people[by].id, expense, version, true)]);
    },
    removeParticipant: (name, by) =>
      send([
        { ...meta(people[by].id), kind: 'participant', participant: people[name], removed: true },
      ]),
  };
}

/** A one-line Expense of `amount` cents, split by `split`. */
const plain = (amount: number, split: Split) => [
  { name: '', unitPrice: amount, quantity: 1, split },
];

/** The Trips one colour scheme walks: seeded afresh for each, so both see the same. */
async function seedTrips() {
  const croatia = await seed(
    'Croatia 2026',
    ['Ania', 'Kasia', 'Tomek', 'Marta'],
    ({ people, at, even, units, amounts }) => [
      {
        title: 'Apartment in Split',
        time: at(3, 16),
        mainPayerId: people.Marta.id,
        lineItems: plain(48000, even()),
      },
      {
        title: 'Parking in Split',
        time: at(3, 17),
        mainPayerId: people.Tomek.id,
        lineItems: plain(1200, even()),
      },
      {
        title: 'Ferry to Hvar',
        time: at(4, 9),
        mainPayerId: people.Tomek.id,
        lineItems: plain(9640, even()),
      },
      // Every option a till Receipt can need: Units, Amounts and Even splits, a Line discount in
      // money and in percent, Deposits, a Deposit refund, a unit nobody took yet, and a Receipt
      // discount. Amounts stay whole cents, so no total shows "≈".
      {
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
      },
      // Tomek left cash for his part of the bill.
      {
        title: 'Dinner at Konoba Fetivi',
        time: at(4, 21),
        mainPayerId: people.Ania.id,
        lineItems: plain(15680, even()),
        contributions: [{ participantId: people.Tomek.id, amount: 4000 }],
      },
      {
        title: 'Kayak rental',
        time: at(5, 11),
        mainPayerId: people.Ania.id,
        lineItems: plain(6000, even(['Ania', 'Tomek'])),
      },
      {
        title: 'Gelato',
        time: at(5, 15),
        mainPayerId: people.Tomek.id,
        lineItems: plain(1400, even()),
      },
      // Income: the kayaks' deposit came back.
      {
        title: 'Kayak deposit back',
        time: at(5, 17),
        mainPayerId: people.Ania.id,
        lineItems: plain(-2000, even(['Ania', 'Tomek'])),
      },
      {
        title: 'Repayment',
        time: at(5, 19),
        mainPayerId: people.Kasia.id,
        recipientId: people.Marta.id,
        amount: 5000,
      },
    ],
  );
  // Kasia adds the dessert to the bill, so the Dinner has a History; and finds the parking was
  // free after all, so Recently deleted has an Expense in it.
  await croatia.edit('Dinner at Konoba Fetivi', 'Kasia', (dinner) =>
    'lineItems' in dinner
      ? { ...dinner, lineItems: plain(16240, dinner.lineItems[0].split) }
      : dinner,
  );
  await croatia.remove('Parking in Split', 'Kasia');

  // Settled: Piotr paid Ania back his half.
  const tatry = await seed('Tatry weekend', ['Ania', 'Piotr'], ({ people, at, even }) => [
    {
      title: 'Mountain hut',
      time: at(1, 18),
      mainPayerId: people.Ania.id,
      lineItems: plain(12000, even()),
    },
    {
      title: 'Repayment',
      time: at(2, 10),
      mainPayerId: people.Piotr.id,
      recipientId: people.Ania.id,
      amount: 6000,
    },
  ]);

  // No Expenses yet.
  const mazury = await seed('Mazury 2026', ['Ania', 'Ola', 'Bartek']);
  return { croatia, tatry, mazury };
}

const PHONE = { width: 390, height: 844 };
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch();

/** Captures the whole set in one colour scheme, on fresh devices that know no Trips. */
async function capture(scheme: 'light' | 'dark'): Promise<void> {
  const { croatia, tatry, mazury } = await seedTrips();
  const shot = new Set<ScreenId>();

  /**
   * A fresh phone (the default), or a browser that blocks notifications (headless Chromium's
   * own answer), or iPhone Safari.
   */
  async function phone(kind: 'fresh' | 'blocked' | 'iphone' = 'fresh') {
    const context = await browser.newContext({
      viewport: PHONE,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
      locale: 'en-US',
      timezoneId: 'Europe/Warsaw',
      ...(kind === 'iphone' && { userAgent: IPHONE_SAFARI }),
    });
    // Headless Chromium reports notifications blocked: a fresh phone hasn't been asked yet,
    // and allows them when asked.
    if (kind === 'fresh') {
      await context.addInitScript(() => {
        Object.defineProperty(Notification, 'permission', { get: () => 'default' });
        Notification.requestPermission = async () => 'granted';
      });
    }
    // Phones have a share sheet; headless Chromium has none, and would offer copying instead.
    await context.addInitScript(() => {
      navigator.share = async () => {};
    });
    const page = await context.newPage();
    return { context, page, ...walk(context, page) };
  }

  /** How a phone is driven: to a page, captured, and offline. */
  function walk(context: BrowserContext, page: Page) {
    // The Nuxt devtools overlay isn't part of the app, and it takes clicks.
    const hideDevtools = () =>
      page.evaluate(() =>
        document.querySelectorAll('[id^="nuxt-devtools"]').forEach((element) => element.remove()),
      );
    const go = async (url: string) => {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await hideDevtools();
    };
    const capture = async (id: ScreenId, fullPage = false) => {
      shot.add(id);
      const themes: readonly string[] = SHOTS[SCREENS[id][2]];
      if (!themes.includes(scheme)) return;
      await page.evaluate(() => document.fonts.ready);
      // Lets sheets and popovers finish sliding in.
      await page.waitForTimeout(700);
      await hideDevtools();
      if (fullPage) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: PHONE.width, height: Math.max(PHONE.height, height) });
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `${out}/${scheme}-${id}.png` });
      if (fullPage) await page.setViewportSize(PHONE);
    };
    const api = `${base}/api/**`;
    // The server unreachable, as offline: the app keeps its changes and syncs them later.
    const offline = () => context.route(api, (route) => route.abort('internetdisconnected'));
    // Back online; the app syncs every Trip as it opens, so the page is reloaded.
    const online = async () => {
      await context.unroute(api);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await hideDevtools();
    };
    return { go, capture, offline, online };
  }

  // First the phones that only look, before the walk below changes the Trip.
  // Just looking, on a browser that blocks notifications.
  {
    const { context, page, go, capture: snap } = await phone('blocked');
    const whoAreYou = page.getByRole('dialog', { name: 'Who are you?' });
    await go(croatia.link);
    await whoAreYou.getByRole('button', { name: 'Just looking' }).click();
    await whoAreYou.waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: /Konzum groceries/ }).waitFor();
    await snap('a13-expenses-just-looking', true);
    await go(`${croatia.page}/notifications`);
    await page.getByText('pick who you are in this Trip first').waitFor();
    await snap('a33-notifications-pick-first', true);
    await page.getByRole('main').getByRole('button', { name: 'Who are you?' }).click();
    await whoAreYou.getByRole('button', { name: 'Ania', exact: true }).click();
    await whoAreYou.waitFor({ state: 'hidden' });
    await page.getByText('To unblock them').waitFor();
    await snap('a36-notifications-blocked', true);
    await context.close();
  }

  // iPhone Safari, outside the installed app.
  {
    const { context, page, go, capture: snap } = await phone('iphone');
    const whoAreYou = page.getByRole('dialog', { name: 'Who are you?' });
    const offer = page.getByRole('dialog', { name: 'Notifications' });
    await go(croatia.link);
    await whoAreYou.getByRole('button', { name: 'Ania', exact: true }).click();
    await offer.getByText('Add Owe Yeah to your Home Screen').waitFor();
    await snap('a08-notifications-offer-iphone');
    await offer.getByRole('button', { name: 'Not now' }).click();
    await offer.waitFor({ state: 'hidden' });
    await go(base);
    await page.getByText('Install Owe Yeah').waitFor();
    await snap('a10-my-trips-install-nudge');
    await go(`${croatia.page}/notifications`);
    await page.getByText('only the installed app gets notifications').waitFor();
    await snap('a37-notifications-home-screen', true);
    await context.close();
  }

  const { context, page, go, capture: snap, offline, online } = await phone();
  const main = page.getByRole('main');
  const whoAreYou = page.getByRole('dialog', { name: 'Who are you?' });
  const offer = page.getByRole('dialog', { name: 'Notifications' });
  const sheet = page.getByRole('dialog');
  const banner = page.getByRole('banner');
  const button = (name: string | RegExp) => page.getByRole('button', { name });
  const link = (name: string | RegExp) => page.getByRole('link', { name });
  const text = (content: string | RegExp) => page.getByText(content).first();
  const close = async () => {
    await page.keyboard.press('Escape');
    await sheet.first().waitFor({ state: 'hidden' });
  };
  /** Opens a Trip link and picks `name`, saying Not now to notifications. */
  const join = async (tripLink: string, name: string) => {
    await go(tripLink);
    await whoAreYou.getByRole('button', { name, exact: true }).click();
    await offer.getByRole('button', { name: 'Not now' }).click();
    await offer.waitFor({ state: 'hidden' });
  };

  // My Trips and New Trip, on a first visit.
  await go(base);
  await link('New Trip').first().waitFor();
  await snap('a01-my-trips-empty');
  await go(`${base}/trips/new`);
  await page.getByLabel('Your name').waitFor();
  await snap('a02-new-trip');
  await page.getByLabel('Trip name').fill('Lake Bled 2026');
  await page.getByLabel('Your name').fill('Ania');
  for (const [index, other] of ['Kasia', 'Tomek', 'Marta'].entries()) {
    if (index > 0) await button('Add another').click();
    await page.getByLabel(`Participant ${index + 2}`).fill(other);
  }
  await snap('a03-new-trip-filled', true);
  await button('Trip currency').click();
  await page.getByRole('listbox').waitFor();
  await snap('a04-new-trip-currency');

  // Joining the Trips; Croatia last, so it tops My Trips.
  await join(tatry.link, 'Ania');
  await join(mazury.link, 'Ania');
  await go(croatia.link);
  await whoAreYou.waitFor();
  await snap('a06-who-are-you');
  await whoAreYou.getByRole('button', { name: 'Ania', exact: true }).click();
  await offer.getByRole('button', { name: 'Turn on' }).waitFor();
  await snap('a07-notifications-offer');
  await offer.getByRole('button', { name: 'Not now' }).click();
  await offer.waitFor({ state: 'hidden' });

  await go(base);
  await link(/Croatia 2026/).waitFor();
  await link(/Tatry weekend/).waitFor();
  await snap('a09-my-trips');
  await button('More').click();
  await page.getByRole('menu').waitFor();
  await snap('a11-app-menu');
  await page.keyboard.press('Escape');

  // The Expenses tab and its header.
  await go(croatia.page);
  await link(/Konzum groceries/).waitFor();
  await snap('a12-expenses', true);
  // The sync status opens in the header, and the same button closes it.
  const syncStatus = banner.getByRole('button', { name: 'Everything is synced.' });
  await syncStatus.click();
  await banner.getByText('Everything is synced.').waitFor();
  await snap('a15-sync-status');
  await syncStatus.click();
  await banner.getByRole('button', { name: 'Invite' }).click();
  await sheet.getByRole('img', { name: 'QR code of the Trip link' }).waitFor();
  await snap('a18-invite');
  await close();

  // Expense details, History.
  const detail = async (title: string, id: ScreenId) => {
    await go(croatia.expensePage(title));
    await page.getByRole('heading', { name: title }).waitFor();
    await snap(id, true);
  };
  await detail('Dinner at Konoba Fetivi', 'b01-expense-detail');
  await detail('Konzum groceries', 'b02-receipt-detail');
  // The Shares heading just under the header, behind the sheet, so the header cuts no line.
  const shares = page.getByRole('region', { name: 'Shares' });
  await shares.evaluate((region) =>
    window.scrollTo(0, region.getBoundingClientRect().top + window.scrollY - 72),
  );
  await shares.getByRole('button', { name: /Ania/ }).click();
  await page.getByRole('dialog', { name: "Ania's share" }).waitFor();
  await snap('b03-share-breakdown');
  await close();
  await detail('Kayak deposit back', 'b04-income-detail');
  await detail('Repayment', 'b05-repayment-detail');
  const dinner = croatia.expensePage('Dinner at Konoba Fetivi');
  await go(`${dinner}/history`);
  await main.getByRole('listitem').nth(1).waitFor();
  await snap('b06-history', true);
  await go(`${dinner}/history/1`);
  await button('Restore this Revision').waitFor();
  await snap('b07-history-revision', true);

  // The Expense form.
  const newExpense = async () => {
    await go(`${croatia.page}/expenses/new`);
    await page.getByRole('textbox', { name: 'Amount', exact: true }).waitFor();
  };
  await newExpense();
  await snap('c01-new-expense', true);
  await button('Save Expense').click();
  await text('Enter a title').waitFor();
  await snap('c02-new-expense-errors', true);
  await newExpense();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('86.40');
  await page.getByLabel('Title').fill('Bakery in Stari Grad');
  await page.getByRole('group', { name: 'Paid by' }).getByRole('radio', { name: 'Kasia' }).check();
  await page
    .getByRole('group', { name: 'For whom' })
    .getByRole('checkbox', { name: 'Marta' })
    .uncheck();
  await snap('c03-new-expense-filled', true);
  await button('Add a Contribution').click();
  await page.getByRole('menuitem', { name: 'Tomek' }).click();
  await page.getByRole('textbox', { name: 'Contribution from Tomek' }).fill('20');
  await text('Kasia pays the rest').waitFor();
  await snap('c04-new-expense-contribution', true);
  await button('Currency').click();
  await page.getByRole('listbox').waitFor();
  await snap('c05-new-expense-currency-picker');
  await page.keyboard.type('HUF');
  await page.getByRole('option', { name: /HUF/ }).click();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('32000');
  await page.getByRole('textbox', { name: 'Contribution from Tomek' }).fill('8000');
  await page.getByRole('textbox', { name: 'Amount charged in EUR' }).fill('80.50');
  await text('Rate: 1 EUR ≈').waitFor();
  await snap('c06-new-expense-foreign-currency', true);
  await newExpense();
  await button(/^When:/).click();
  await page.getByLabel('When').waitFor();
  await snap('c07-new-expense-when', true);
  await newExpense();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('20');
  await page.getByLabel('Title').fill('Deposit back for the bikes');
  await page.getByRole('switch', { name: 'Money received' }).click();
  await button('Save Income').waitFor();
  await snap('c08-new-income', true);
  await go(`${dinner}/edit`);
  await page.getByRole('textbox', { name: 'Contribution from Tomek' }).waitFor();
  await snap('c09-edit-expense', true);
  await go(`${croatia.expensePage('Repayment')}/edit`);
  await button('Save Repayment').waitFor();
  await snap('c20-edit-repayment', true);

  // Receipts.
  await newExpense();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('23.40');
  await button('Itemise as a Receipt').click();
  await text('Receipt total').waitFor();
  await snap('c10-receipt-start', true);
  await go(`${croatia.expensePage('Konzum groceries')}/edit`);
  const line = (name: RegExp) => page.getByRole('button', { name, expanded: false });
  await line(/Orange juice/).waitFor();
  await snap('c11-receipt-form', true);
  await line(/Orange juice/).click();
  await snap('c12-receipt-line-units', true);
  await button('Done').click();
  await line(/Sunscreen/).click();
  await snap('c13-receipt-line-amounts', true);
  await button('Line discount and Deposit').click();
  await page.getByText('Deposit per unit').first().waitFor();
  await snap('c14-receipt-line-extras', true);
  await button('Done').click();
  await line(/Pršut/).click();
  await snap('c15-receipt-line-even', true);
  await button('Done').click();
  await button('Add a Line item').click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  await adding.getByLabel('New Line item name').fill('Tomatoes');
  await adding.getByLabel('New Line item unit price').fill('2.49');
  await adding.getByLabel('New Line item quantity').fill('2');
  // The stepper takes what is typed when it loses focus.
  await adding.getByLabel('New Line item quantity').press('Tab');
  await snap('c16-receipt-adding', true);
  await button('Add a Deposit refund').click();
  await page
    .getByRole('group', { name: 'Add a Deposit refund' })
    .getByLabel('Deposit refund amount')
    .fill('1.95');
  await snap('c17-receipt-refund', true);

  // Balances, and Repayments.
  const balances = async (remote: { page: string }) => {
    await go(`${remote.page}/balances`);
    await page.getByRole('region', { name: 'Everyone' }).waitFor();
  };
  await balances(croatia);
  await snap('a19-balances', true);
  await page
    .getByRole('region', { name: 'Everyone' })
    .getByRole('button', { name: /Kasia/ })
    .click();
  await page.getByRole('dialog', { name: "Kasia's balance" }).waitFor();
  await snap('a20-balances-breakdown');
  await close();
  await link(/^Record Repayment/)
    .first()
    .click();
  await button('Save Repayment').waitFor();
  await snap('c18-repayment-suggested', true);
  await go(`${croatia.page}/repayments/new`);
  await button('Save Repayment').waitFor();
  await snap('c19-repayment-new', true);

  // As Marta, who is owed.
  await balances(croatia);
  await banner.getByRole('button', { name: /You are Ania/ }).click();
  await whoAreYou.waitFor();
  await snap('a21-who-are-you-change');
  await whoAreYou.getByRole('button', { name: 'Marta', exact: true }).click();
  await whoAreYou.waitFor({ state: 'hidden' });
  // Remind says how it reminds once the server said whom it can reach.
  await button(/^Remind \w+ with a message/)
    .first()
    .waitFor();
  await snap('a22-balances-owed', true);
  await banner.getByRole('button', { name: /You are Marta/ }).click();
  await whoAreYou.getByRole('button', { name: 'Ania', exact: true }).click();
  await whoAreYou.waitFor({ state: 'hidden' });
  await balances(tatry);
  await text('All settled').waitFor();
  await snap('a23-balances-settled', true);

  // The Trip tab and the pages under it.
  const settings = async (remote: { page: string }) => {
    await go(`${remote.page}/settings`);
    await page.getByRole('region', { name: 'Participants' }).waitFor();
  };
  const participant = (name: string) =>
    page
      .getByRole('region', { name: 'Participants' })
      .getByRole('button', { name: new RegExp(`^${name}`) });
  await settings(croatia);
  await snap('a24-trip-tab', true);
  await button('Add Participant').click();
  await page.getByRole('dialog', { name: 'Add Participant' }).getByLabel('Name').fill('Zofia');
  await snap('a25-add-participant');
  await close();
  await participant('Tomek').click();
  await page.getByRole('dialog', { name: 'Tomek' }).getByText("can't be removed").waitFor();
  await snap('a26-participant-on-expenses');
  await close();
  await button('Forget this Trip').click();
  await page.getByRole('dialog', { name: 'Forget this Trip' }).waitFor();
  await snap('a28-forget-trip');
  await close();
  await go(`${croatia.page}/details`);
  await text('Last changed by you').waitFor();
  await snap('a31-trip-details', true);
  await go(`${croatia.page}/deleted`);
  await text('Deleted by Kasia · ').waitFor();
  await snap('a32-recently-deleted', true);
  await go(`${croatia.page}/notifications`);
  await button('Turn on').waitFor();
  await snap('a34-notifications-off', true);
  await button('Turn on').click();
  await text("Notifications couldn't be turned on").waitFor();
  await snap('a35-notifications-failed', true);
  await go(`${base}/privacy`);
  await main.locator('h2').first().waitFor();
  await snap('a38-privacy', true);
  await go(`${base}/terms`);
  await main.locator('h2').first().waitFor();
  await snap('a39-terms', true);
  await go(`${base}/nonexistent-page`);
  await text("This page doesn't exist.").waitFor();
  await snap('a40-not-found');

  // Delete asks nothing: Undo is the way back.
  await go(croatia.expensePage('Ferry to Hvar'));
  await button('Delete Expense').click();
  await text('Deleted “Ferry to Hvar”').waitFor();
  await snap('b08-deleted-undo');

  // A Conflict: the Gelato edited here offline while Tomek's edit of it reaches the server.
  await go(croatia.expensePage('Gelato'));
  await link('Edit Expense').click();
  await page.getByLabel('Title').waitFor();
  await offline();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('18.50');
  await page.getByLabel('Title').fill('Gelato and lemonade');
  await button('Save Expense').click();
  await text('Not synced yet').waitFor();
  await snap('b09-expense-not-synced', true);
  await go(croatia.page);
  const gelato = page.getByRole('link').filter({ hasText: 'Gelato and lemonade' });
  await gelato.waitFor();
  // At the end of the list, as a phone left there would be: the tab keeps its scroll.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const unsyncedStatus = banner.getByRole('button', { name: '1 change not synced' });
  await unsyncedStatus.click();
  await banner.getByText("Will sync when you're online").waitFor();
  await snap('a16-sync-unsynced');
  await unsyncedStatus.click();
  await croatia.edit('Gelato', 'Tomek', (expense) =>
    'lineItems' in expense
      ? { ...expense, lineItems: plain(1650, expense.lineItems[0].split) }
      : expense,
  );
  await online();
  await gelato.filter({ hasText: 'Conflict' }).waitFor();
  await snap('b10-expenses-conflict', true);
  await gelato.click();
  await link('Choose version').waitFor();
  await snap('b11-expense-conflict', true);
  await link('Choose version').click();
  await page.getByRole('region', { name: "Tomek's version" }).waitFor();
  await snap('b12-conflict', true);

  // A Trip without Expenses; a removal another device's Expense refuses; and this device's
  // Participant removed by someone else.
  await go(mazury.page);
  await text('No Expenses yet').waitFor();
  await snap('a14-expenses-empty', true);
  await settings(mazury);
  await participant('Bartek').click();
  const bartek = page.getByRole('dialog', { name: 'Bartek' });
  await bartek.getByRole('button', { name: 'Remove from Trip' }).waitFor();
  await snap('a27-participant-removable');
  await offline();
  await bartek.getByRole('button', { name: 'Remove from Trip' }).click();
  await bartek.waitFor({ state: 'hidden' });
  await participant('Bartek').waitFor({ state: 'detached' });
  await button('Forget this Trip').click();
  await text('1 change on this device').waitFor();
  await snap('a29-forget-trip-unsynced');
  await close();
  await mazury.add('Ola', {
    title: 'Sailboat rental',
    time: { instant: '2026-08-08T08:00:00.000Z', zone: 'Europe/Warsaw' },
    mainPayerId: mazury.people.Ola.id,
    lineItems: plain(36000, {
      mode: 'even',
      participantIds: [mazury.people.Ola.id, mazury.people.Bartek.id],
    }),
  });
  await online();
  await link('Expenses').click();
  await text("Bartek wasn't removed").waitFor();
  await link(/Sailboat rental/).waitFor();
  await snap('a17-trip-notice', true);
  await mazury.removeParticipant('Ania', 'Ola');
  await page.reload();
  await whoAreYou.getByText('was removed from the Trip').waitFor();
  await snap('a30-who-are-you-removed');

  // A Trip created offline, before it reaches the server.
  await offline();
  await go(`${base}/trips/new`);
  await page.getByLabel('Trip name').fill('Weekend in Gdańsk');
  await page.getByLabel('Your name').fill('Ania');
  await page.getByLabel('Participant 2').fill('Kasia');
  await button('Create Trip').click();
  await main.getByRole('button', { name: 'Invite' }).click();
  await sheet.getByText("The Trip hasn't synced yet").waitFor();
  await snap('a05-invite-not-synced');
  await context.close();

  // SAFETY: `SCREENS` has exactly these keys.
  const missed = (Object.keys(SCREENS) as ScreenId[]).filter((id) => !shot.has(id));
  if (missed.length > 0) throw new Error(`${scheme}: not captured: ${missed.join(', ')}`);
}

await capture('light');
await capture('dark');
await browser.close();
const count = Object.values(SCREENS).reduce((sum, [, , shots]) => sum + SHOTS[shots].length, 0);
console.log(`${count} screenshots and screens.json in ${out}`);
