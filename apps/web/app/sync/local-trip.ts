import {
  referencedParticipantIds,
  type Edited,
  type Expense,
  type Participant,
  type RateEntry,
  type StoredExpense,
  type TripSnapshot,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import type { ExpenseBase, Held, OutboxEntry, QueuedChange } from './db';

/**
 * Why an Expense shown on this device has not reached the others yet, with the Claim sent
 * with the device's latest change of it (`null` without one): who made this version.
 */
export type Unsynced = ({ status: 'pending' } | Held) & { claimId: string | null };

/**
 * Who made what this device shows and when, by the server's clock; `at` is `null` for a
 * change made on this device the server has not answered yet.
 */
export type LocalEdited = Omit<Edited, 'at'> & { at: string | null };

/** An Expense as this device shows it, which may include changes not synced yet. */
export type LocalExpense = Expense & {
  /** Deleted softly: listed under Recently deleted, where it can be restored. */
  deleted: boolean;
  /** Who made the version shown and when; `null` where not known. */
  edited: LocalEdited | null;
  /** What a new edit of the Expense is based on. */
  base: ExpenseBase;
  /** `null` once the server has the Expense as shown. */
  unsynced: Unsynced | null;
};

/** Who takes part in a Trip, with those removed softly kept apart. */
type TripPeople = Pick<TripSnapshot, 'participants' | 'removedParticipants'>;

/**
 * A Trip as this device shows it: the pulled Trip with the outbox on top. Deleted Expenses
 * and removed Participants are kept apart, so balances, the Expense list and the pickers
 * never see them; older versions and deleted Expenses can still name removed Participants.
 */
export type LocalTrip = TripWithParticipants &
  TripPeople & {
    /** Who last changed the Trip's details and when; `null` where not known. */
    edited: LocalEdited | null;
    expenses: LocalExpense[];
    /** Deleted Expenses, for Recently deleted. */
    deletedExpenses: LocalExpense[];
    /** The rate entries this device has, converting Expenses into the Trip currency. */
    rates: readonly RateEntry[];
  };

/** A Trip as this device shows it, before deleted Expenses are set apart. */
type AllExpenses = Omit<LocalTrip, 'deletedExpenses' | 'rates'>;

/** An Expense of the Trip by its id, deleted or not. */
export function findExpense(trip: LocalTrip, expenseId: string): LocalExpense | undefined {
  return [...trip.expenses, ...trip.deletedExpenses].find(({ id }) => id === expenseId);
}

/** The Expense itself, without what this device knows about it, e.g. to save it again. */
export function toExpense(local: LocalExpense): Expense {
  const {
    deleted: _deleted,
    edited: _edited,
    base: _base,
    unsynced: _unsynced,
    ...expense
  } = local;
  return expense;
}

/**
 * The Trip as this device shows it: `snapshot` with every change still in the outbox applied
 * on top, in order, so a pull never hides the device's own changes (ADR 0002). An Expense
 * with a held change stays held, whatever was queued after it. Deleted Expenses are set apart.
 * A pending Expense brings back the removed Participants it references, as the server will.
 * Expenses are converted with `rates`, the rate entries the device has. `null` when there is
 * nothing to show yet: a joined Trip before its first pull.
 */
export function localTrip(
  snapshot: TripSnapshot | null,
  outbox: readonly OutboxEntry[],
  rates: readonly RateEntry[],
): LocalTrip | null {
  let trip: AllExpenses | null = snapshot && {
    id: snapshot.id,
    name: snapshot.name,
    currency: snapshot.currency,
    edited: snapshot.edited,
    participants: snapshot.participants,
    removedParticipants: snapshot.removedParticipants,
    expenses: snapshot.expenses.map(({ version, ...expense }) => ({
      ...expense,
      base: { version },
      unsynced: null,
    })),
  };

  for (const { tripId, change, held } of outbox) {
    if (change.kind === 'trip') {
      const edited = { by: change.claimId, at: null };
      trip = trip
        ? { ...trip, ...change.trip, edited }
        : {
            id: tripId,
            ...change.trip,
            edited,
            participants: [],
            removedParticipants: [],
            expenses: [],
          };
    } else if (trip && change.kind === 'participant') {
      trip = { ...trip, ...withParticipant(trip, change.participant, change.removed) };
    } else if (trip && change.kind === 'expense') {
      if (!change.deleted) trip = { ...trip, ...restoredBy(trip, change.expense) };
      const before = trip.expenses.find(({ id }) => id === change.expense.id)?.unsynced;
      const heldBefore = before && before.status !== 'pending' ? before : null;
      trip = {
        ...trip,
        expenses: upsert(trip.expenses, {
          ...change.expense,
          deleted: change.deleted,
          edited: { by: change.claimId, at: null },
          base: { after: change.id },
          unsynced: { ...(heldBefore ?? held ?? { status: 'pending' }), claimId: change.claimId },
        }),
      };
    }
  }
  return (
    trip && {
      ...trip,
      expenses: trip.expenses.filter(({ deleted }) => !deleted),
      deletedExpenses: trip.expenses.filter(({ deleted }) => deleted),
      rates,
    }
  );
}

/**
 * The snapshot with a change the server accepted applied, an Expense at the version it got,
 * so the device shows it without waiting for the next pull. The snapshot's own version
 * stays, so that pull still brings whatever others changed meanwhile, with who made the
 * Expense's version and when. A Trip created on this device gets its first snapshot here, at
 * version 0.
 */
export function withAccepted(
  snapshot: TripSnapshot | null,
  tripId: string,
  change: QueuedChange,
  version: number | null,
): TripSnapshot | null {
  switch (change.kind) {
    case 'trip':
      return snapshot
        ? { ...snapshot, ...change.trip }
        : {
            id: tripId,
            ...change.trip,
            edited: null,
            participants: [],
            removedParticipants: [],
            expenses: [],
            version: 0,
          };
    case 'participant':
      return (
        snapshot && {
          ...snapshot,
          ...withParticipant(snapshot, change.participant, change.removed),
        }
      );
    case 'expense':
      return (
        snapshot &&
        withExpense(
          change.deleted ? snapshot : { ...snapshot, ...restoredBy(snapshot, change.expense) },
          { ...change.expense, version: version ?? 1, deleted: change.deleted, edited: null },
        )
      );
  }
}

/** The snapshot with `expense` as the server has it, e.g. the current one from a Conflict. */
export function withExpense(snapshot: TripSnapshot, expense: StoredExpense): TripSnapshot {
  return { ...snapshot, expenses: upsert(snapshot.expenses, expense) };
}

/** The Trip's people with `participant` added, renamed, removed or brought back. */
function withParticipant(
  people: TripPeople,
  participant: Participant,
  removed: boolean,
): TripPeople {
  const others = (list: readonly Participant[]) => list.filter(({ id }) => id !== participant.id);
  return removed
    ? {
        participants: others(people.participants),
        removedParticipants: upsert(people.removedParticipants, participant),
      }
    : {
        participants: upsert(people.participants, participant),
        removedParticipants: others(people.removedParticipants),
      };
}

/** The Trip's people with the removed Participants `expense` references brought back. */
function restoredBy(people: TripPeople, expense: Expense): TripPeople {
  const referenced = referencedParticipantIds(expense);
  return people.removedParticipants
    .filter(({ id }) => referenced.has(id))
    .reduce<TripPeople>((restored, participant) => withParticipant(restored, participant, false), {
      participants: people.participants,
      removedParticipants: people.removedParticipants,
    });
}

/** `items` with `item` in place of the one with its id, or added at the end. */
function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  return items.some(({ id }) => id === item.id)
    ? items.map((other) => (other.id === item.id ? item : other))
    : [...items, item];
}
