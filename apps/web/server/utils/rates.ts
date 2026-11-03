import {
  isRateDateOver,
  neededRates,
  rateEntrySchema,
  type Currency,
  type RateEntry,
  type Trip,
} from '@osi/owe-yeah-domain';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { useRuntimeConfig } from 'nuxt/server';
import { z } from 'zod';
import { getDb } from '../db';
import { expenses, rates } from '../db/schema';

// A rate the provider answered without fixing (not fixed yet, or not covered) is asked for
// again only after this long, so devices pulling every 30 s don't hammer Frankfurter; while
// the provider can't be reached, after a short while. Per process.
const RETRY_AFTER_MS = 60 * 60 * 1000;
const UNREACHABLE_RETRY_MS = 60 * 1000;
// How far around the dates a fetch reaches: before, for a latest rate to fall back on while a
// date's own is not published; after, to see whether the provider skipped a date for good.
const AROUND_MS = 7 * 24 * 60 * 60 * 1000;

/** When each `date from to` entry that is not fixed may be asked for again. */
const retryAt = new Map<string, number>();

const key = (date: string, from: string, to: string) => `${date} ${from} ${to}`;

/**
 * The rate entries a Trip's Expenses (deleted ones aside) need, as the whole-Trip pull
 * brings them (ADR 0003). Fills the rate table lazily: an entry that is missing, or not
 * fixed yet, is fetched from Frankfurter, at most once an hour (`RETRY_AFTER_MS`). A fixed
 * entry is never fetched or changed again. Without the provider, the pull brings what the
 * table has.
 */
export async function loadTripRates(trip: Trip): Promise<RateEntry[]> {
  const rows = await getDb()
    .select({ state: expenses.state })
    .from(expenses)
    .where(and(eq(expenses.tripId, trip.id), not(expenses.deleted)));
  return loadRates(
    rows.map(({ state }) => state),
    trip.currency,
  );
}

/**
 * The rate entries `states` need to be converted into the Trip currency, filling the rate
 * table as `loadTripRates` does: e.g. for an Expense as it was before a change.
 */
export async function loadRates(
  states: Parameters<typeof neededRates>[0],
  currency: Trip['currency'],
): Promise<RateEntry[]> {
  const needed = neededRates(states, currency);
  if (needed.length === 0) return [];

  const stored = await selectRates(needed, currency);
  const now = Date.now();
  const stale = needed.filter(({ date, from }) => {
    const entry = key(date, from, currency);
    return !stored.get(entry)?.fixed && (retryAt.get(entry) ?? 0) <= now;
  });
  if (stale.length === 0) return [...stored.values()];

  for (const [from, entries] of Map.groupBy(stale, ({ from }) => from)) {
    const dates = entries.map(({ date }) => date);
    const fetched = await fetchRates(from, currency, dates);
    const wait = fetched ? RETRY_AFTER_MS : UNREACHABLE_RETRY_MS;
    for (const date of dates) retryAt.set(key(date, from, currency), now + wait);
    if (!fetched?.length) continue;
    for (const { date, fixed } of fetched) {
      if (fixed) retryAt.delete(key(date, from, currency));
    }
    await getDb()
      .insert(rates)
      .values(fetched)
      .onConflictDoUpdate({
        target: [rates.date, rates.from, rates.to],
        set: { rate: sql`excluded.rate`, fixed: sql`excluded.fixed` },
        // A fixed rate never changes, even when two pulls race to fill it.
        setWhere: not(rates.fixed),
      });
  }
  return [...(await selectRates(needed, currency)).values()];
}

/** The table's entries among `needed`, by `key`. */
async function selectRates(
  needed: readonly { date: string; from: Currency }[],
  to: Trip['currency'],
): Promise<Map<string, RateEntry>> {
  const wanted = new Set(needed.map(({ date, from }) => key(date, from, to)));
  const rows = await getDb()
    .select({
      date: rates.date,
      from: rates.from,
      to: rates.to,
      rate: rates.rate,
      fixed: rates.fixed,
    })
    .from(rates)
    .where(
      and(
        eq(rates.to, to),
        inArray(rates.from, [...new Set(needed.map(({ from }) => from))]),
        inArray(rates.date, [...new Set(needed.map(({ date }) => date))]),
      ),
    );
  return new Map(
    rows
      .filter(({ date, from }) => wanted.has(key(date, from, to)))
      .map((row) => [key(row.date, row.from, row.to), rateEntrySchema.parse(row)]),
  );
}

// What Frankfurter's `/v2/rates` answers for a range: a row per date it has a rate for.
const frankfurterRowsSchema = z.array(
  z.object({ date: z.iso.date(), rate: z.number().positive() }),
);

/**
 * Frankfurter's blended mid rates of `from` in `to` for `dates`, one request for all of them.
 * Each date takes the provider's rate for it or, while that is not published yet, the latest
 * before it. It is fixed once the date is over everywhere and the rate is the date's own, or
 * the provider has published a later one, so it skipped the date for good. Empty when the
 * provider doesn't cover the pair; `null` when it can't be reached.
 */
async function fetchRates(from: Currency, to: Trip['currency'], dates: readonly string[]) {
  const sorted = dates.toSorted();
  const shift = (date: string, ms: number) =>
    new Date(Date.parse(date) + ms).toISOString().slice(0, 10);
  const url = new URL('/v2/rates', useRuntimeConfig().frankfurterUrl);
  url.search = new URLSearchParams({
    base: from,
    quotes: to,
    from: shift(sorted[0]!, -AROUND_MS),
    to: shift(sorted.at(-1)!, AROUND_MS),
  }).toString();

  let published: z.infer<typeof frankfurterRowsSchema>;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    // A refused currency is not covered; a failing or busy provider is tried again soon.
    if (!response.ok) return response.status < 500 && response.status !== 429 ? [] : null;
    published = frankfurterRowsSchema
      .parse(await response.json())
      .toSorted((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.warn(`Frankfurter rates of ${from} in ${to} could not be fetched`, error);
    return null;
  }

  const now = new Date().toISOString();
  return sorted.flatMap((date) => {
    const latest = published.filter((row) => row.date <= date).at(-1);
    if (!latest) return [];
    const final = latest.date === date || published.some((row) => row.date > date);
    // Postgres reads an exponent (`8e-7`) too, and gives the rate back as a plain decimal.
    const rate = String(latest.rate);
    return [{ date, from, to, rate, fixed: final && isRateDateOver(date, now) }];
  });
}
