import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { participantIdSchema } from './participant.ts';
import { TRIP_CURRENCIES, type TripWithParticipants } from './trip.ts';

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

/** An Even split: equal parts for every ticked Participant, each ticked once. */
const evenSplitSchema = z.object({
  mode: z.literal('even'),
  participantIds: z
    .array(participantIdSchema)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'A Participant can be ticked only once',
    }),
});

/** An amount in whole minor units of its currency (cents for EUR), so it stays exact in JSON. */
const minorAmountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * One position of an Expense. A negative unit price is money received, which makes a plain
 * Expense Income; it is never zero.
 */
const lineItemSchema = z.object({
  unitPrice: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .refine((price) => price !== 0, { message: 'A Line item is never zero' }),
  split: evenSplitSchema,
});

/**
 * What every Expense has. It carries its own currency, which for now must be the Trip
 * currency. `mainPayerId` is who paid, or who received the money of an Income.
 */
const expenseBase = {
  id: expenseIdSchema,
  title: expenseTitleSchema,
  currency: z.enum(TRIP_CURRENCIES),
  time: expenseTimeSchema,
  mainPayerId: participantIdSchema,
};

/**
 * An Expense split by its Line items. A plain Expense has exactly one; with a negative total
 * it is Income.
 */
const splitExpenseSchema = z.object({
  ...expenseBase,
  lineItems: z.array(lineItemSchema).length(1),
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
  'currencyNotTripCurrency',
  'repaymentToSelf',
]);

export type ExpenseProblem = z.infer<typeof expenseProblemSchema>;

/**
 * The rules an Expense must follow within its Trip; empty when it may be saved. The device
 * checks them before pushing and the server again before accepting. A Repayment's recipient
 * counts as its ticked Participant.
 */
export function expenseProblems(expense: Expense, trip: TripWithParticipants): ExpenseProblem[] {
  const known = new Set(trip.participants.map(({ id }) => id));
  const ticked = isRepayment(expense)
    ? [expense.recipientId]
    : expense.lineItems.flatMap(({ split }) => split.participantIds);
  const problems: ExpenseProblem[] = [];

  if (!known.has(expense.mainPayerId)) problems.push('unknownMainPayer');
  if (ticked.some((id) => !known.has(id))) problems.push('unknownParticipant');
  if (expense.currency !== trip.currency) problems.push('currencyNotTripCurrency');
  if (isRepayment(expense) && expense.recipientId === expense.mainPayerId) {
    problems.push('repaymentToSelf');
  }
  return problems;
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
