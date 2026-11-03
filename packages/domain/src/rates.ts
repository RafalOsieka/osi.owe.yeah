import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { currencySchema, type Currency } from './currency.ts';
import { localDay, type Expense } from './expense.ts';
import { decimal, rateSchema, type ManualRate } from './manual-rate.ts';
import { fromMinor } from './money.ts';
import { divide, multiply, rational, type Rational } from './rational.ts';
import { expenseShares } from './shares.ts';
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
  rate: rateSchema,
  fixed: z.boolean(),
});

export type RateEntry = z.infer<typeof rateEntrySchema>;

/** What an Expense is converted with: the Trip currency and the rate table at hand. */
export type TripRates = { currency: TripCurrency; rates: readonly RateEntry[] };

/**
 * The rate converting an Expense into the Trip currency, exact, whether it is a Provisional
 * rate (amounts converted with it are approximate and update by themselves), and whether it
 * comes from a Manual rate; `null` without one.
 */
export type ExpenseRate = { rate: Rational; provisional: boolean; manual: boolean } | null;

/**
 * What an Expense's rate depends on: its currency, its local date, its Manual rate, and its
 * total in its own currency, which a charged amount is divided by. The Expense form converts a
 * total still being typed with it (`conversionRate`).
 */
export type Conversion = Pick<Expense, 'currency' | 'time' | 'manualRate'> & { total: Rational };

/**
 * The rate converting an Expense into the Trip currency (see `conversionRate`), at its total
 * as it is now.
 */
export function expenseRate(expense: Expense, trip: TripRates): ExpenseRate {
  return conversionRate({ ...expense, total: expenseShares(expense).total }, trip);
}

/**
 * The rate converting an Expense into the Trip currency. In the Trip currency itself it is 1.
 * A Manual rate replaces the automatic one: typed as a rate it is that rate; typed as the
 * amount charged it is charged ÷ total, exact, so the charged amount stays what the Expense
 * comes to however its Receipt is edited (`null` while the total is zero). Otherwise it is
 * looked up by the Expense's local date and currency, never stored on it (ADR 0003): see
 * `automaticRate`.
 */
export function conversionRate(conversion: Conversion, trip: TripRates): ExpenseRate {
  if (conversion.currency === trip.currency) {
    return { rate: rational(1n), provisional: false, manual: false };
  }
  const date = localDay(conversion.time);
  const { manualRate } = conversion;
  if (!manualRate) {
    const found = automaticRate(conversion.currency, date, trip);
    return found && { ...found, manual: false };
  }
  const typed = manualRateValue(manualRate, conversion.total);
  if (!typed) return null;
  if (manualRate.currency === trip.currency)
    return { rate: typed, provisional: false, manual: true };
  const chained = automaticRate(manualRate.currency, date, trip);
  return chained && { ...chained, rate: multiply(typed, chained.rate), manual: true };
}

/**
 * A Manual rate's value in the currency it targets: the rate typed, or the amount charged ÷
 * the magnitude of the total (`null` while the total is zero).
 */
function manualRateValue(manualRate: ManualRate, total: Rational): Rational | null {
  if (manualRate.kind === 'rate') return decimal(manualRate.rate);
  if (total.numerator === 0n) return null;
  const magnitude = rational(abs(total.numerator), total.denominator);
  return divide(fromMinor(manualRate.amount, manualRate.currency), magnitude);
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/**
 * The automatic rate of `from` in the Trip currency on a local `date`: the fixed rate for
 * that date; else the date's rate that is not fixed yet, or else the latest rate the table
 * has for the pair, as a Provisional rate. `null` for a pair the table has never seen: an
 * Expense converted with it is left out of balances until a rate arrives.
 */
function automaticRate(from: Currency, date: string, trip: TripRates) {
  const pair = trip.rates.filter((entry) => entry.from === from && entry.to === trip.currency);
  const sameDate = pair.find((entry) => entry.date === date);
  const latest = pair.toSorted((a, b) => b.date.localeCompare(a.date))[0];
  const found = sameDate ?? latest;
  if (!found) return null;
  return { rate: decimal(found.rate), provisional: found !== sameDate || !found.fixed };
}

/**
 * How many Expenses are converted at a Provisional rate, and how many have no rate at all
 * and are left out of balances, as the Balances tab warns about them.
 */
export function rateSummary(trip: TripRates & { expenses: readonly Expense[] }) {
  const found = trip.expenses.map((expense) => expenseRate(expense, trip));
  return {
    provisional: found.filter((rate) => rate?.provisional).length,
    missing: found.filter((rate) => rate === null).length,
  };
}

/**
 * The rates Expenses need to be converted into the Trip currency `to`: each local date and
 * currency once, in the order the Expenses first need them. An Expense with a Manual rate
 * needs the rate of the currency it targets, which it is chained through, or none when that
 * is `to`. The backend fills these lazily on the pull.
 */
export function neededRates(
  expenses: readonly Pick<Expense, 'currency' | 'time' | 'manualRate'>[],
  to: TripCurrency,
): { date: string; from: Currency }[] {
  const needed = new Map<string, { date: string; from: Currency }>();
  for (const { currency, time, manualRate } of expenses) {
    const from = currency === to ? to : (manualRate?.currency ?? currency);
    if (from === to) continue;
    const date = localDay(time);
    needed.set(`${date} ${from}`, { date, from });
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
