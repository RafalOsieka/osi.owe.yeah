import {
  expenseSchema,
  pushProblemSchema,
  storedExpenseSchema,
  type StoredExpense,
} from '@osi/owe-yeah-domain';
import type { z } from 'zod';
import type { DeviceTrip, Held, Notice, OutboxEntry } from './db';

/**
 * One link of the device store's migration chain: how a Trip and an outbox entry kept by the
 * version before are kept by this one. Pure, so each link is tested on its own; `DeviceDb`
 * runs them in order in Dexie `upgrade()` hooks. Links are typed as the store keeps things
 * now, though what a link adds is missing before it runs.
 */
export type Migration = {
  trip: (trip: DeviceTrip) => DeviceTrip;
  entry: (entry: OutboxEntry) => OutboxEntry;
};

/** v1 → v2: deletes and Revisions. */
export const toV2 = {
  trip: (trip) =>
    trip.snapshot
      ? {
          ...trip,
          // Version 0 is older than any the server has, so the next pull brings the whole Trip
          // again, now with who made each Expense's version.
          snapshot: {
            ...trip.snapshot,
            version: 0,
            expenses: trip.snapshot.expenses.map(beforeRevisions),
          },
        }
      : trip,
  entry: (entry) =>
    entry.change.kind === 'expense'
      ? {
          ...entry,
          change: { ...entry.change, deleted: false },
          held: withConflictCurrent(entry.held, beforeRevisions),
        }
      : entry,
} satisfies Migration;

/** v2 → v3: Receipts, whose Line items have a name and a quantity. */
export const toV3 = {
  trip: (trip) =>
    trip.snapshot
      ? {
          ...trip,
          snapshot: {
            ...trip.snapshot,
            expenses: trip.snapshot.expenses.map((expense) =>
              beforeReceipts(storedExpenseSchema, expense),
            ),
          },
        }
      : trip,
  entry: (entry) =>
    entry.change.kind === 'expense'
      ? {
          ...entry,
          change: { ...entry.change, expense: beforeReceipts(expenseSchema, entry.change.expense) },
          held: withConflictCurrent(entry.held, (current) =>
            beforeReceipts(storedExpenseSchema, current),
          ),
        }
      : entry,
} satisfies Migration;

/** v3 → v4: Notices, Trip details with who changed them, and removed Participants. */
export const toV4 = {
  trip: (trip) => ({
    ...trip,
    notices: [],
    // Version 0 brings the whole Trip again, now with who last changed its details and its
    // removed Participants.
    snapshot: trip.snapshot && {
      ...trip.snapshot,
      version: 0,
      edited: null,
      removedParticipants: [],
    },
  }),
  entry: (entry) =>
    entry.change.kind === 'participant'
      ? { ...entry, change: { ...entry.change, removed: false } }
      : entry,
} satisfies Migration;

/** v4 → v5: Expenses in any currency, with cached rates. */
export const toV5 = {
  trip: (trip) => ({
    ...trip,
    rates: [],
    lastCurrency: null,
    // Notices of a Trip currency refused while Expenses were not converted yet go.
    notices: trip.notices.filter(({ kind }) => noticeKinds.has(kind)),
  }),
  entry: (entry) => {
    if (entry.held?.status !== 'rejected') return entry;
    // An Expense in another currency than the Trip's is accepted now: sent again.
    const problems = entry.held.problems.filter(
      (problem) => pushProblemSchema.safeParse(problem).success,
    );
    return { ...entry, held: problems.length > 0 ? { ...entry.held, problems } : null };
  },
} satisfies Migration;

/**
 * The chain, oldest first: link `i` takes the store to version `i + 2`. A link is never
 * changed or removed once released, as a device may come back after any number of releases
 * (ADR 0002); a new schema appends one.
 */
export const migrations: readonly Migration[] = [toV2, toV3, toV4, toV5];

/** The kinds of Notice there are, to drop those of older versions of the store. */
const noticeKinds = new Set<string>([
  'participantRestored',
  'removalRefused',
  'claimRemoved',
] satisfies Notice['kind'][]);

/** A held Conflict with its current Expense mapped; any other held answer as it was. */
function withConflictCurrent(
  held: Held | null,
  map: (current: StoredExpense) => StoredExpense,
): Held | null {
  return held?.status === 'conflict' ? { ...held, current: map(held.current) } : held;
}

/**
 * An Expense kept by version 1 of the store, from before deletes and Revisions: never deleted,
 * and who made its version is not known.
 */
function beforeRevisions(expense: StoredExpense): StoredExpense {
  return { ...expense, deleted: false, edited: null };
}

/**
 * An Expense kept by version 2 of the store, from before Receipts, read again with `schema`,
 * whose defaults make each Line item one unnamed unit. Anything unreadable is kept as it was.
 */
function beforeReceipts<E>(schema: z.ZodType<E>, expense: E): E {
  return schema.safeParse(expense).data ?? expense;
}
