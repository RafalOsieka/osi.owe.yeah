import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { currencySchema, type Currency } from './currency.ts';
import { localDay, type Expense } from './expense.ts';
import { rational, type Rational } from './rational.ts';
import { TRIP_CURRENCIES, type TripCurrency } from './trip.ts';

/**
 * One entry of the rate table our backend fills from Frankfurter (ADR 0003): how much one
 * unit of `from` is in `to` on a calendar `date`, as the provider gave it (a plain decimal).
 * A `fixed` rate never changes again; one that is not fixed yet (its date is not over) is
 * a Provisional rate. The whole-Trip pull brings the entries its Expenses need.
 */
export const rateEntrySchema = z.object({
  date: z.iso.date(),
  from: currencySchema,
  to: z.enum(TRIP_CURRENCIES),
  rate: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .refine((rate) => /[1-9]/.test(rate), { message: 'A rate is positive' }),
  fixed: z.boolean(),
});

export type RateEntry = z.infer<typeof rateEntrySchema>;

/** What an Expense is converted with: the Trip currency and the rate table at hand. */
export type TripRates = { currency: TripCurrency; rates: readonly RateEntry[] };

/**
 * The rate converting an Expense into the Trip currency, exact, and whether it is a
 * Provisional rate (amounts converted with it are approximate and update by themselves);
 * `null` without one.
 */
export type ExpenseRate = { rate: Rational; provisional: boolean } | null;

/**
 * The rate converting an Expense into the Trip currency, looked up by the Expense's local
 * date and currency, never stored on it (ADR 0003): the fixed rate for that date; else the
 * date's rate that is not fixed yet, or else the latest rate the table has for the pair, as a
 * Provisional rate. `null` for a pair the table has never seen: such an Expense is left out
 * of balances until a rate arrives. In the Trip currency itself, the rate is 1.
 */
export function expenseRate(
  expense: Pick<Expense, 'currency' | 'time'>,
  trip: TripRates,
): ExpenseRate {
  if (expense.currency === trip.currency) return { rate: rational(1n), provisional: false };
  const date = localDay(expense.time);
  const pair = trip.rates.filter(
    ({ from, to }) => from === expense.currency && to === trip.currency,
  );
  const sameDate = pair.find((entry) => entry.date === date);
  const latest = pair.toSorted((a, b) => b.date.localeCompare(a.date))[0];
  const found = sameDate ?? latest;
  if (!found) return null;
  return { rate: decimal(found.rate), provisional: found !== sameDate || !found.fixed };
}

/** A plain decimal (`0.87593`) as an exact Rational. */
function decimal(text: string): Rational {
  const [whole, fraction = ''] = text.split('.');
  return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}

/**
 * How many Expenses are converted at a Provisional rate, and how many have no rate at all
 * and are left out of balances, as the Balances tab warns about them.
 */
export function rateSummary(
  trip: TripRates & { expenses: readonly Pick<Expense, 'currency' | 'time'>[] },
) {
  const found = trip.expenses.map((expense) => expenseRate(expense, trip));
  return {
    provisional: found.filter((rate) => rate?.provisional).length,
    missing: found.filter((rate) => rate === null).length,
  };
}

/**
 * The rates Expenses need to be converted into the Trip currency `to`: each local date and
 * currency once, in the order the Expenses first need them. The backend fills these lazily
 * on the pull.
 */
export function neededRates(
  expenses: readonly Pick<Expense, 'currency' | 'time'>[],
  to: TripCurrency,
): { date: string; from: Currency }[] {
  const needed = new Map<string, { date: string; from: Currency }>();
  for (const { currency, time } of expenses) {
    if (currency === to) continue;
    const date = localDay(time);
    needed.set(`${date} ${currency}`, { date, from: currency });
  }
  return [...needed.values()];
}

/**
 * Whether a rate's date is over at `now` (an ISO instant): ended in every time zone, the
 * last being UTC−12. Only then can its rate be fixed, never to change again; until then it
 * is a Provisional rate.
 */
export function isRateDateOver(date: string, now: string): boolean {
  const lastZoneToday = Temporal.Instant.from(now).toZonedDateTimeISO('Etc/GMT+12').toPlainDate();
  return Temporal.PlainDate.compare(date, lastZoneToday) < 0;
}
