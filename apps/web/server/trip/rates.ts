import {
  isRateDateOver,
  neededRates,
  rateEntrySchema,
  type Currency,
  type RateEntry,
  type RateLookup,
  type Trip,
} from '@osi/owe-yeah-domain';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client';
import { rates } from '../db/schema';
import { LruMap } from '../utils/lru-map';
import type { WholeTrip } from './store';

// A rate the provider answered without fixing (not fixed yet, or not covered) is asked for
// again only after this long, so devices pulling every 30 s don't hammer Frankfurter; while
// the provider can't be reached, after a short while.
const RETRY_AFTER_MS = 60 * 60 * 1000;
const UNREACHABLE_RETRY_MS = 60 * 1000;
// How far around the dates a fetch reaches: before, for a latest rate to fall back on while a
// date's own is not published; after, to see whether the provider skipped a date for good.
const AROUND_MS = 7 * 24 * 60 * 60 * 1000;
// How many entries `retryAt` remembers. One dropped early is only asked for again sooner.
const RETRY_ENTRIES = 10_000;

const key = (date: string, from: string, to: string) => `${date} ${from} ${to}`;
const pairKey = (from: string, to: string) => `${from} ${to}`;

/**
 * The rate table, filled lazily from Frankfurter at `frankfurterUrl` (ADR 0003). An entry
 * that is missing, or not fixed yet, is fetched at most once an hour (`RETRY_AFTER_MS`) per
 * instance; the server builds one. A fixed entry is never fetched or changed again. Without
 * the provider, the table gives what it has. The pull never waits for the provider: it gets
 * what the table has, and the rest is filled in the background for a later pull.
 */
export function createRates(db: Database, frankfurterUrl: string) {
  /**
   * When each `date from to` entry that is not fixed may be asked for again, for the
   * `RETRY_ENTRIES` used most recently.
   */
  const retryAt = new LruMap<string, number>(RETRY_ENTRIES);
  /**
   * The fetch under way for each `date from to` entry, settling once the table has its answer,
   * so no entry is fetched twice at a time and callers that wait for it join the one under way.
   */
  const fetching = new Map<string, Promise<void>>();
  /** The `from to` pairs the provider refused when last asked: it doesn't cover them. */
  const notCovered = new Set<string>();

  /** The table's entries among `needed`, by `key`. */
  async function selectRates(
    needed: readonly { date: string; from: Currency }[],
    to: Trip['currency'],
  ): Promise<Map<string, RateEntry>> {
    const wanted = new Set(needed.map(({ date, from }) => key(date, from, to)));
    const rows = await db
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

  /**
   * The table's entries among `needed` in `currency` now, and what fills in the rest: the
   * fetches under way for any of them, and one started for those missing or not fixed that
   * were not asked for lately. `null` when nothing does. A failed fill is only logged.
   */
  async function storedAndFilling(
    needed: readonly { date: string; from: Currency }[],
    currency: Trip['currency'],
  ) {
    const stored = await selectRates(needed, currency);
    const now = Date.now();
    const unfixed = needed
      .map(({ date, from }) => ({ date, from, entry: key(date, from, currency) }))
      .filter(({ entry }) => !stored.get(entry)?.fixed);
    const stale = unfixed.filter(
      ({ entry }) => !fetching.has(entry) && (retryAt.get(entry) ?? 0) <= now,
    );
    if (stale.length > 0) {
      const started = fill(stale, currency)
        .catch((error: Error) => console.warn(`Rates in ${currency} could not be filled`, error))
        .finally(() => stale.forEach(({ entry }) => fetching.delete(entry)));
      for (const { entry } of stale) fetching.set(entry, started);
    }
    const waiting = new Set(unfixed.flatMap(({ entry }) => fetching.get(entry) ?? []));
    return { stored, filling: waiting.size > 0 ? Promise.all(waiting) : null };
  }

  /** Fills the table from the provider with the `stale` entries in `currency`. */
  async function fill(
    stale: readonly { date: string; from: Currency }[],
    currency: Trip['currency'],
  ): Promise<void> {
    for (const [from, entries] of Map.groupBy(stale, ({ from }) => from)) {
      const dates = entries.map(({ date }) => date);
      const fetched = await fetchRates(frankfurterUrl, from, currency, dates);
      const now = Date.now();
      const wait = fetched === 'unreachable' ? UNREACHABLE_RETRY_MS : RETRY_AFTER_MS;
      for (const date of dates) retryAt.set(key(date, from, currency), now + wait);
      if (fetched === 'unreachable') continue;
      if (fetched === 'notCovered') {
        notCovered.add(pairKey(from, currency));
        continue;
      }
      notCovered.delete(pairKey(from, currency));
      if (fetched.length === 0) continue;
      for (const { date, fixed } of fetched) {
        if (fixed) retryAt.delete(key(date, from, currency));
      }
      await db
        .insert(rates)
        .values(fetched)
        .onConflictDoUpdate({
          target: [rates.date, rates.from, rates.to],
          set: { rate: sql`excluded.rate`, fixed: sql`excluded.fixed` },
          // A fixed rate never changes, even when two pulls race to fill it.
          setWhere: not(rates.fixed),
        });
    }
  }

  /**
   * The table's entries among `needed` in `currency`, once the table is filled from the
   * provider with those that are missing or not fixed, unless they were asked for lately.
   */
  async function filled(
    needed: readonly { date: string; from: Currency }[],
    currency: Trip['currency'],
  ): Promise<RateEntry[]> {
    if (needed.length === 0) return [];
    const { stored, filling } = await storedAndFilling(needed, currency);
    if (!filling) return [...stored.values()];
    await filling;
    return [...(await selectRates(needed, currency)).values()];
  }

  /**
   * The rate entries `expenses` need to be converted into the Trip currency, filling the
   * rate table as they go: e.g. for an Expense as it was before a change.
   */
  function forExpenses(
    expenses: Parameters<typeof neededRates>[0],
    currency: Trip['currency'],
  ): Promise<RateEntry[]> {
    return filled(neededRates(expenses, currency), currency);
  }

  return {
    forExpenses,

    /**
     * The rate entry of `from` (not `to` itself) in the Trip currency `to` on `date`, once the
     * table is filled with it, for the Expense form to convert with before the Expense is saved;
     * or why there is none: the provider doesn't cover `from`, or there is no telling yet
     * (`RateLookup`).
     */
    async lookup(date: string, from: Currency, to: Trip['currency']): Promise<RateLookup> {
      const [entry] = await filled([{ date, from }], to);
      if (entry) return { status: 'found', entry };
      return { status: notCovered.has(pairKey(from, to)) ? 'notCovered' : 'unknown' };
    },

    /**
     * The rate entries a Trip's Expenses (deleted ones aside) need, as the whole-Trip pull
     * brings them (ADR 0003): those the table has now. The rest are filled in the background,
     * so the provider never holds up the pull, and a later pull brings them.
     */
    async forTrip(trip: WholeTrip): Promise<RateEntry[]> {
      const needed = neededRates(
        trip.expenses.filter(({ deleted }) => !deleted),
        trip.currency,
      );
      if (needed.length === 0) return [];
      const { stored } = await storedAndFilling(needed, trip.currency);
      return [...stored.values()];
    },
  };
}

export type Rates = ReturnType<typeof createRates>;

// What Frankfurter's `/v2/rates` answers for a range: a row per date it has a rate for.
const frankfurterRowsSchema = z.array(
  z.object({ date: z.iso.date(), rate: z.number().positive() }),
);

/**
 * Frankfurter's blended mid rates of `from` in `to` for `dates`, one request for all of them.
 * Each date takes the provider's rate for it or, while that is not published yet, the latest
 * before it. It is fixed once the date is over everywhere and the rate is the date's own, or
 * the provider has published a later one, so it skipped the date for good; a date it has no
 * rate on or before yet gets none. `notCovered` when the provider refuses the pair;
 * `unreachable` when it can't be reached.
 */
async function fetchRates(
  frankfurterUrl: string,
  from: Currency,
  to: Trip['currency'],
  dates: readonly string[],
): Promise<RateEntry[] | 'notCovered' | 'unreachable'> {
  const sorted = dates.toSorted();
  const shift = (date: string, ms: number) =>
    new Date(Date.parse(date) + ms).toISOString().slice(0, 10);
  const url = new URL('/v2/rates', frankfurterUrl);
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
    if (!response.ok) {
      return response.status < 500 && response.status !== 429 ? 'notCovered' : 'unreachable';
    }
    published = frankfurterRowsSchema
      .parse(await response.json())
      .toSorted((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.warn(`Frankfurter rates of ${from} in ${to} could not be fetched`, error);
    return 'unreachable';
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
