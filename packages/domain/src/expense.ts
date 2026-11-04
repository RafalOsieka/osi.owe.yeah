import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { discountExceeds, discountSchema } from './discount.ts';
import {
  LINE_ITEM_PROBLEMS,
  isDepositRefund,
  goodsMinor,
  lineItemProblems,
  lineItemSchema,
  minorAmountSchema,
  receiptTotalMinor,
  splitParticipantIds,
  type LineItem,
} from './line-item.ts';
import { currencySchema } from './currency.ts';
import { manualRateSchema } from './manual-rate.ts';
import { compare, rational } from './rational.ts';
import { participantIdSchema } from './participant.ts';
import type { TripWithParticipants } from './trip.ts';

/** An Expense id: a UUIDv7 generated on the device, so it can be created offline (ADR 0002). */
export const expenseIdSchema = z.uuid({ version: 'v7' });

/** An Expense title: free text that also names the merchant, e.g. "Lidl Rovinj". */
export const expenseTitleSchema = z.string().trim().min(1).max(100);

function isTimeZone(zone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}

function isInstant(instant: string): boolean {
  try {
    Temporal.Instant.from(instant);
    return true;
  } catch {
    return false;
  }
}

/**
 * When an Expense happened: a UTC instant plus the IANA zone it happened in, so it reads
 * the same local time wherever it is viewed. The instant is normalised to UTC (`…Z`).
 */
export const expenseTimeSchema = z.object({
  instant: z
    .string()
    .refine(isInstant, { message: 'Expected an ISO instant with an offset' })
    .transform((instant) => Temporal.Instant.from(instant).toString()),
  zone: z.string().refine(isTimeZone, { message: 'Expected an IANA time zone' }),
});

export type ExpenseTime = z.infer<typeof expenseTimeSchema>;

/**
 * What every Expense has. It carries its own currency, any in circulation, which all its
 * amounts are in; it is converted into the Trip currency at the rate for its local date
 * (`expenseRate`), never stored on it (ADR 0003), unless someone typed a Manual rate for it;
 * without one the field is left out. `mainPayerId` is who paid, or who received the money of
 * an Income.
 */
const expenseBase = {
  id: expenseIdSchema,
  title: expenseTitleSchema,
  currency: currencySchema,
  time: expenseTimeSchema,
  mainPayerId: participantIdSchema,
  manualRate: manualRateSchema.optional(),
};

/**
 * A Contribution: a fixed amount in minor units that a Participant other than the Main payer
 * paid towards an Expense, e.g. a cash tip.
 */
const contributionSchema = z.object({
  participantId: participantIdSchema,
  amount: minorAmountSchema,
});

export type Contribution = z.infer<typeof contributionSchema>;

const onePerParticipant = (contributions: readonly Contribution[]) =>
  new Set(contributions.map(({ participantId }) => participantId)).size === contributions.length;

/**
 * An Expense split by its Line items, in the order of the Receipt, with an optional Receipt
 * discount on all of them, and optional Contributions, one per Participant in the order they
 * were added; the Main payer covers the rest. Without Contributions the field is left out. A
 * plain Expense has exactly one Line item; with a negative total it is Income.
 */
const splitExpenseSchema = z.object({
  ...expenseBase,
  lineItems: z.array(lineItemSchema).min(1).max(500),
  discount: discountSchema.optional(),
  contributions: z
    .array(contributionSchema)
    .min(1)
    .max(100)
    .refine(onePerParticipant, { message: 'A Participant can contribute only once' })
    .optional(),
});

/**
 * A Repayment: money the Main payer handed to `recipientId`, with no Line-item split. Told
 * apart from other Expenses by having a recipient.
 */
const repaymentSchema = z.object({
  ...expenseBase,
  recipientId: participantIdSchema,
  amount: minorAmountSchema,
});

/** An Expense's full state, as the client pushes it and the whole-Trip pull returns it. */
export const expenseSchema = z.union([splitExpenseSchema, repaymentSchema]);

export type Expense = z.infer<typeof expenseSchema>;
export type SplitExpense = z.infer<typeof splitExpenseSchema>;
export type Repayment = z.infer<typeof repaymentSchema>;

/** Whether an Expense is a Repayment, told apart by having a recipient; narrows any Expense type. */
export function isRepayment<E extends Expense>(expense: E): expense is Extract<E, Repayment> {
  return 'recipientId' in expense;
}

/**
 * An Expense named by its kind, with its type narrowed to match (see `expenseKind`). Whatever
 * else `E` carries, e.g. a device's sync state, stays on it.
 */
export type KindedExpense<E extends Expense = Expense> =
  | { kind: 'repayment'; expense: Extract<E, Repayment> }
  | { kind: 'receipt'; expense: Exclude<E, Repayment> }
  | { kind: 'plain' | 'income'; expense: Exclude<E, Repayment> & { lineItems: [LineItem] } };

/**
 * An Expense's kind, the one place that decides it:
 * - `repayment`: it has a recipient;
 * - `plain` (a plain Expense) or `income`: its one Line item is unnamed, a single unit,
 *   undiscounted, without a Deposit and split Even, with no Receipt discount; Income when that
 *   Line item is negative;
 * - `receipt`: entered Line item by Line item, otherwise. A Receipt whose Deposit refunds
 *   outweigh its goods stays a Receipt.
 */
export function expenseKind<E extends Expense>(expense: E): KindedExpense<E> {
  if (isRepayment(expense)) return { kind: 'repayment', expense };
  // SAFETY: an Expense without a recipient is a split one; TS can't narrow a generic `E` on
  // the false branch of `isRepayment`.
  const split = expense as Exclude<E, Repayment>;
  const { lineItems, discount } = split;
  const [only, ...more] = lineItems;
  const receipt =
    more.length > 0 ||
    only!.name !== '' ||
    only!.quantity > 1 ||
    only!.split.mode !== 'even' ||
    only!.discount !== undefined ||
    only!.depositPerUnit !== undefined ||
    discount !== undefined;
  if (receipt) return { kind: 'receipt', expense: split };
  // SAFETY: not a Receipt means `more` is empty, so its one Line item is `only`.
  const single = split as Exclude<E, Repayment> & { lineItems: [LineItem] };
  return { kind: isDepositRefund(only!) ? 'income' : 'plain', expense: single };
}

/** An Expense without its id, as the server keeps its state; one type per kind of Expense. */
export type ExpenseState = Expense extends infer E
  ? E extends unknown
    ? Omit<E, 'id'>
    : never
  : never;

/** Why an Expense that is well-formed on its own does not fit its Trip. */
export const expenseProblemSchema = z.enum([
  'unknownMainPayer',
  'unknownParticipant',
  'repaymentToSelf',
  ...LINE_ITEM_PROBLEMS,
  'receiptDiscountExceedsLineItems',
  'contributionFromMainPayer',
  'contributionsExceedTotal',
  'chargedWithoutTotal',
  'manualRateToOwnCurrency',
]);

export type ExpenseProblem = z.infer<typeof expenseProblemSchema>;

/** Who an Expense is for besides its Main payer: its split, its Contributions or its recipient. */
function tickedParticipantIds(expense: Expense): string[] {
  return isRepayment(expense)
    ? [expense.recipientId]
    : [
        ...expense.lineItems.flatMap(({ split }) => splitParticipantIds(split)),
        ...(expense.contributions ?? []).map(({ participantId }) => participantId),
      ];
}

/** Every Participant an Expense references: its Main payer and whoever it is for. */
export function referencedParticipantIds(expense: Expense): Set<string> {
  return new Set([expense.mainPayerId, ...tickedParticipantIds(expense)]);
}

/**
 * How many of `expenses` reference a Participant, e.g. "Ania is on 4 Expenses": while any
 * does, the Participant cannot be removed, so money never loses its owner.
 */
export function expensesReferencing(expenses: readonly Expense[], participantId: string): number {
  return expenses.filter((expense) => referencedParticipantIds(expense).has(participantId)).length;
}

/**
 * The rules an Expense must follow within its Trip; empty when it may be saved. The device
 * checks them before pushing and the server again before accepting. A Repayment's recipient
 * counts as its ticked Participant, and so does everyone with a Contribution. Every Line item
 * must fit together (`lineItemProblems`), and the Receipt discount may not take off more than
 * the goods come to after their Line discounts. The total may be negative. The Main payer
 * makes no Contribution, and Contributions may cover the whole total but not more, so the
 * Main payer's part is never negative and Income has none. A Manual rate must be one a rate
 * can be made of: an amount charged needs a total other than zero, and it targets a currency
 * other than the Expense's own (see `conversionRate`).
 */
export function expenseProblems(expense: Expense, trip: TripWithParticipants): ExpenseProblem[] {
  const known = new Set(trip.participants.map(({ id }) => id));
  const ticked = tickedParticipantIds(expense);
  const problems: ExpenseProblem[] = [];

  if (!known.has(expense.mainPayerId)) problems.push('unknownMainPayer');
  if (ticked.some((id) => !known.has(id))) problems.push('unknownParticipant');
  if (isRepayment(expense) && expense.recipientId === expense.mainPayerId) {
    problems.push('repaymentToSelf');
  }
  if (!isRepayment(expense)) {
    const { lineItems } = expense;
    const lineProblems = new Set(lineItems.flatMap(lineItemProblems));
    problems.push(...LINE_ITEM_PROBLEMS.filter((problem) => lineProblems.has(problem)));
    if (receiptDiscountExceeds(expense)) problems.push('receiptDiscountExceedsLineItems');
    const contributions = expense.contributions ?? [];
    if (contributions.some(({ participantId }) => participantId === expense.mainPayerId)) {
      problems.push('contributionFromMainPayer');
    }
    if (contributionsExceed(expense)) problems.push('contributionsExceedTotal');
    const total = receiptTotalMinor(lineItems, expense.discount);
    if (expense.manualRate?.kind === 'charged' && total.numerator === 0n) {
      problems.push('chargedWithoutTotal');
    }
  }
  if (expense.manualRate?.currency === expense.currency) problems.push('manualRateToOwnCurrency');
  return problems;
}

/**
 * Whether a Receipt discount takes off more than the goods come to after their Line
 * discounts (`goodsMinor`); checked while the Receipt is entered as well as before it is saved.
 */
export function receiptDiscountExceeds({
  lineItems,
  discount,
}: Pick<SplitExpense, 'lineItems' | 'discount'>): boolean {
  return discountExceeds(discount, goodsMinor(lineItems));
}

/**
 * Whether Contributions add up to more than the Expense comes to (`receiptTotalMinor`), which
 * would leave the Main payer a negative part.
 */
function contributionsExceed({
  lineItems,
  discount,
  contributions = [],
}: Pick<SplitExpense, 'lineItems' | 'discount' | 'contributions'>): boolean {
  if (contributions.length === 0) return false;
  const contributed = contributions.reduce((sum, { amount }) => sum + BigInt(amount), 0n);
  return compare(rational(contributed), receiptTotalMinor(lineItems, discount)) > 0;
}

function zoned(time: ExpenseTime): Temporal.ZonedDateTime {
  return Temporal.Instant.from(time.instant).toZonedDateTimeISO(time.zone);
}

/** The Expense's calendar day in its own zone (`YYYY-MM-DD`), which the Expense list groups by. */
export function localDay(time: ExpenseTime): string {
  return zoned(time).toPlainDate().toString();
}

/** The Expense's local date and time in its own zone, as a `datetime-local` input shows it. */
export function localDateTime(time: ExpenseTime): string {
  return zoned(time).toPlainDateTime().toString({ smallestUnit: 'minute' });
}

/**
 * An Expense time from a local date and time (`YYYY-MM-DDTHH:mm`) in a zone. A local time
 * that a DST change skips moves forward by the gap; one it repeats takes the earlier instant
 * (Temporal's `compatible` disambiguation).
 */
export function expenseTimeFromLocal(local: string, zone: string): ExpenseTime {
  const instant = Temporal.PlainDateTime.from(local).toZonedDateTime(zone).toInstant();
  return { instant: instant.toString(), zone };
}

/** The zone this device is in, the default for new Expenses. */
export function deviceTimeZone(): string {
  return Temporal.Now.timeZoneId();
}

/**
 * Expenses grouped by their own local day (see `localDay`), newest day first and newest
 * Expense first within a day, as the Expense list shows them.
 */
export function groupByLocalDay<T extends Pick<Expense, 'time'>>(
  expenses: readonly T[],
): { day: string; expenses: T[] }[] {
  const newestFirst = expenses.toSorted((a, b) =>
    Temporal.Instant.compare(b.time.instant, a.time.instant),
  );
  const days = Map.groupBy(newestFirst, (expense) => localDay(expense.time));
  return [...days]
    .toSorted(([a], [b]) => b.localeCompare(a))
    .map(([day, grouped]) => ({ day, expenses: grouped }));
}
