import {
  EXPENSE_LIMIT,
  PARTICIPANT_LIMIT,
  expenseChangeProblems,
  expensesReferencing,
  restoredBy,
  syncChangeSchema,
  tripChangeSchema,
  tripCurrencyLocked,
  tripIdSchema,
  tripTokenSchema,
  type ChangeResult,
  type ExpenseChange,
  type ParticipantChange,
  type PullResponse,
  type PushEnvelope,
  type PushResponse,
  type ServerTrip,
  type SyncChange,
  type TripChange,
  type TripPeople,
} from '@osi/owe-yeah-domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { changes, expenses, participants, revisions, trips } from '../db/schema';
import { hashTripToken } from '../utils/trip-token';
import type { Rates } from './rates';
import { createTripStore, tripPeople, type TripStore, type WholeTrip } from './store';

/** An Expense change the sync push has just applied (not a retry), with the version it made. */
export type AppliedExpenseChange = { change: ExpenseChange; version: number };

/** Who hears about the Expense changes a push has just applied: the Web Push adapter in production. */
export type Notifier = {
  /** Called once a push has answered, fire-and-forget; never with no changes. */
  notifyAffected(tripId: string, applied: readonly AppliedExpenseChange[]): Promise<void>;
};

/**
 * What the sync answers a request without a valid Trip link. It doesn't say whether the Trip
 * exists, except to a push that creates one, which is refused when the id is taken. That is
 * left as it is: Trip ids are UUIDv7s, and guessing one is infeasible.
 */
export type InvalidLink = 'invalidLink';

/** What the sync answers a push that would create a Trip, when the creation isn't allowed. */
export type TooManyTrips = 'tooManyTrips';

/**
 * The server side of the sync (ADR 0002), mirroring the device's `Transport`: the push and the
 * whole-Trip pull, each for a Trip id and its Trip link's token (ADR 0001). Writes go to `db`;
 * Trips are read through `store`, or a Trip store on a transaction of `db` where a read must be
 * consistent, and converted at `rates`; `notifier` hears of the Expense changes each push
 * applies.
 */
export function createTripSync(db: Database, store: TripStore, rates: Rates, notifier: Notifier) {
  /** The first result of a change this Trip has applied before, if it has. */
  async function appliedBefore(change: SyncChange, tripId: string): Promise<ChangeResult | null> {
    const [applied] = await db
      .select({ version: changes.version, restored: changes.restored })
      .from(changes)
      .where(and(eq(changes.id, change.id), eq(changes.tripId, tripId)));
    if (!applied) return null;
    return accepted(change.id, applied.version, applied.restored ?? []);
  }

  /**
   * Applies one change unless it was applied before, in a transaction of its own that locks
   * the Trip first (`lockTrip`). `fresh` says whether this push applied it, not an earlier one.
   */
  async function applyOnce(
    change: SyncChange,
    tripId: string,
  ): Promise<{ result: ChangeResult; fresh: boolean }> {
    const before = await appliedBefore(change, tripId);
    if (before) return { result: before, fresh: false };

    switch (change.kind) {
      case 'trip':
        return { result: await applyTripChange(change, tripId), fresh: true };
      case 'participant':
        return { result: await applyParticipantChange(change, tripId), fresh: true };
      case 'expense': {
        const applied = await applyExpenseChange(change, tripId);
        if (applied) return { result: applied, fresh: true };
        // Not applied, unless a retry of the same change racing this one applied it.
        const result = (await appliedBefore(change, tripId)) ?? (await refusal(change, tripId));
        return { result, fresh: false };
      }
    }
  }

  /**
   * A Trip's details, last write wins; who sent the change is who last changed them. A new
   * Trip currency causes no Conflict, as no Expense changes with it, but is refused once the
   * Trip has a Repayment (deleted ones aside), whichever of the two came first on the device.
   */
  async function applyTripChange(change: TripChange, tripId: string): Promise<ChangeResult> {
    const changeId = change.id;
    return db.transaction(async (tx): Promise<ChangeResult> => {
      const trip = await lockTrip(tx, tripId);
      const { name, currency } = change.trip;
      const live = trip.expenses.filter(({ deleted }) => !deleted);
      if (currency !== trip.currency && tripCurrencyLocked(live)) {
        return { changeId, status: 'rejected', problems: ['tripHasRepayments'] };
      }
      await tx.update(trips).set({ name, currency }).where(eq(trips.id, tripId));
      await recordChange(tx, change, tripId, tripId, null);
      return { changeId, status: 'accepted', version: null };
    });
  }

  /**
   * Adds, renames, removes or brings back a Participant, last write wins. Removing one that an
   * Expense references (deleted ones aside) is refused, and so is an id another Trip uses, and
   * adding or bringing back one past `PARTICIPANT_LIMIT`.
   */
  async function applyParticipantChange(
    change: ParticipantChange,
    tripId: string,
  ): Promise<ChangeResult> {
    const { id: changeId, participant, removed } = change;
    return db.transaction(async (tx): Promise<ChangeResult> => {
      const trip = await lockTrip(tx, tripId);
      const live = trip.expenses.filter(({ deleted }) => !deleted);
      const referenced = removed && expensesReferencing(live, participant.id) > 0;
      if (referenced) return { changeId, status: 'rejected', problems: ['participantReferenced'] };
      const people = tripPeople(trip.participants);
      const alreadyIn = people.participants.some(({ id }) => id === participant.id);
      if (!removed && !alreadyIn && tooMany(people, 1)) {
        return { changeId, status: 'rejected', problems: ['tooManyParticipants'] };
      }

      // An id another Trip uses is left alone: the update is limited to this Trip's row.
      const [upserted] = await tx
        .insert(participants)
        .values({ ...participant, removed, tripId })
        .onConflictDoUpdate({
          target: participants.id,
          set: { name: participant.name, removed },
          setWhere: eq(participants.tripId, tripId),
        })
        .returning({ id: participants.id });
      if (!upserted) return { changeId, status: 'rejected', problems: ['participantIdTaken'] };

      await recordChange(tx, change, tripId, participant.id, null);
      return { changeId, status: 'accepted', version: null };
    });
  }

  /**
   * Creates the Expense (base version `null`) or updates it if it is still at the base
   * version, in one conditional statement so concurrent pushes cannot both win, and adds the
   * Revision it makes. Removed Participants still count as the Trip's, and an Expense that is
   * not deleted brings back those it references, unless that makes the Trip's Participants more
   * than `PARTICIPANT_LIMIT`. A new Expense past `EXPENSE_LIMIT` is refused. Returns nothing
   * when the change did not apply.
   */
  async function applyExpenseChange(
    change: ExpenseChange,
    tripId: string,
  ): Promise<ChangeResult | null> {
    const { id, ...state } = change.expense;
    const { id: changeId, deleted } = change;
    return db.transaction(async (tx): Promise<ChangeResult | null> => {
      const trip = await lockTrip(tx, tripId);
      const people = tripPeople(trip.participants);
      const problems = expenseChangeProblems(change, people);
      if (problems.length > 0) return { changeId, status: 'rejected', problems };
      // A creation of an Expense the Trip has already is left to end as a Conflict.
      const creating = change.baseVersion === null && !trip.expenses.some((e) => e.id === id);
      if (creating && trip.expenses.length >= EXPENSE_LIMIT) {
        return { changeId, status: 'rejected', problems: ['tooManyExpenses'] };
      }
      const restored = restoredBy(people, change).map(({ id }) => id);
      if (restored.length > 0 && tooMany(people, restored.length)) {
        return { changeId, status: 'rejected', problems: ['tooManyParticipants'] };
      }

      const [stored] =
        change.baseVersion === null
          ? await tx
              .insert(expenses)
              .values({ id, tripId, version: 1, state, deleted })
              .onConflictDoNothing({ target: expenses.id })
              .returning({ version: expenses.version })
          : await tx
              .update(expenses)
              .set({ version: sql`${expenses.version} + 1`, state, deleted })
              .where(
                and(
                  eq(expenses.id, id),
                  eq(expenses.tripId, tripId),
                  eq(expenses.version, change.baseVersion),
                ),
              )
              .returning({ version: expenses.version });
      if (!stored) return null;
      await tx.insert(revisions).values({
        expenseId: id,
        version: stored.version,
        tripId,
        state,
        deleted,
        claimId: change.claimId,
        deviceId: change.deviceId,
      });

      if (restored.length > 0) {
        await tx
          .update(participants)
          .set({ removed: false })
          .where(and(eq(participants.tripId, tripId), inArray(participants.id, restored)));
      }
      await recordChange(tx, change, tripId, id, stored.version, restored);
      return accepted(changeId, stored.version, restored);
    });
  }

  /**
   * Why an Expense change did not apply: the Expense is not where or at the version expected.
   * A Conflict says who made the current version, by the Claim sent with that change.
   */
  async function refusal(change: ExpenseChange, tripId: string): Promise<ChangeResult> {
    const changeId = change.id;
    const current = (await store.readTrip(tripId))?.expenses.find(
      ({ id }) => id === change.expense.id,
    );
    if (current) {
      return { changeId, status: 'conflict', current, currentClaimId: current.edited?.by ?? null };
    }
    const [elsewhere] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.id, change.expense.id));
    return {
      changeId,
      status: 'rejected',
      problems: [elsewhere ? 'expenseIdTaken' : 'unknownExpense'],
    };
  }

  /**
   * Creates the Trip `tripId` under `token`, unless a Trip with that id (or token) exists
   * already: how a Trip created on a device, maybe offline, reaches the server. Whether the
   * push may then use the Trip is still for its Trip link to say. `mayCreate` is asked only
   * when the Trip is missing. Answers why the push is refused, if it is: a token too weak to be
   * a Trip link, or a creation `mayCreate` refused.
   */
  async function createTripIfMissing(
    tripId: string,
    token: string,
    details: TripChange['trip'],
    mayCreate: () => boolean,
  ): Promise<InvalidLink | TooManyTrips | null> {
    const id = tripIdSchema.safeParse(tripId);
    if (!id.success) return null;
    const [existing] = await db.select({ id: trips.id }).from(trips).where(eq(trips.id, id.data));
    if (existing) return null;
    const strong = tripTokenSchema.safeParse(token);
    if (!strong.success) return 'invalidLink';
    if (!mayCreate()) return 'tooManyTrips';
    await db
      .insert(trips)
      .values({ id: id.data, ...details, tokenHash: hashTripToken(strong.data) })
      .onConflictDoNothing();
    return null;
  }

  return {
    /**
     * The sync push: applies a device's outbox changes in order and answers with a result per
     * change. A push carrying a Trip change creates the Trip if the server doesn't have it
     * yet and `mayCreate` allows it; a creation it refuses refuses the whole push. Trip
     * details and Participants are last-write-wins, except that a Participant an Expense
     * references is never removed. A new Trip currency rewrites no Expense (ADR 0003).
     * An Expense change carries the Expense's full new state and the version it was based on;
     * it is accepted only if it follows the Trip's rules and that version is still current,
     * and then kept as a Revision. It brings back any removed Participant it references.
     * Deletes and restores are Expense changes like edits. A change applied before is
     * answered as the first time and not applied again. Once it has answered, the notifier
     * hears of the Expense changes this push applied. The Trip link is checked before any
     * change is applied (only a creation's Trip details are read before it); a change that
     * isn't `syncChangeSchema` is refused as `malformed`.
     */
    async push(
      tripId: string,
      token: string,
      { changes: pushed }: PushEnvelope,
      mayCreate: () => boolean = () => true,
    ): Promise<PushResponse | InvalidLink | TooManyTrips> {
      const creation = pushed
        .map((change) => tripChangeSchema.safeParse(change).data)
        .find((change) => change !== undefined);
      const refused =
        creation && (await createTripIfMissing(tripId, token, creation.trip, mayCreate));
      if (refused) return refused;
      const trip = await store.tripByLink(tripId, token);
      if (!trip) return 'invalidLink';

      const results: ChangeResult[] = [];
      const applied: AppliedExpenseChange[] = [];
      for (const unread of pushed) {
        const change = syncChangeSchema.safeParse(unread).data;
        if (!change) {
          results.push({ changeId: unread.id, status: 'rejected', problems: ['malformed'] });
          continue;
        }
        const { result, fresh } = await applyOnce(change, trip.id);
        results.push(result);
        if (fresh && change.kind === 'expense' && result.status === 'accepted' && result.version) {
          applied.push({ change, version: result.version });
        }
      }
      // Fire-and-forget: the device doesn't wait for anyone to be notified.
      if (applied.length > 0) void notifier.notifyAffected(trip.id, applied);
      return { results };
    },

    /**
     * The whole-Trip pull: the Trip with its Participants and its Expenses. Given `since`, the
     * Trip version the device has, it answers `trip: null` while the Trip is still at that
     * version. Either way it brings the rate entries the Trip's Expenses need that the rate
     * table has (ADR 0003), without waiting for the provider: the rest are filled in the
     * background for a later pull, and rates become fixed without the Trip changing. The Trip
     * is read in one repeatable-read transaction, so it is as it was at one moment, between two
     * applied changes and never inside one: e.g. never with an Expense whose new Participant it
     * doesn't show.
     */
    async pull(tripId: string, token: string, since?: number): Promise<PullResponse | InvalidLink> {
      const trip = await db.transaction(
        async (tx) => {
          const snapshot = createTripStore(tx);
          const linked = await snapshot.tripByLink(tripId, token);
          return linked && (await snapshot.readTrip(linked.id));
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      if (!trip) return 'invalidLink';
      return {
        trip: since === trip.version ? null : serverTripOf(trip),
        rates: await rates.forTrip(trip),
      };
    },
  };
}

export type TripSync = ReturnType<typeof createTripSync>;

/**
 * Locks the Trip until the transaction ends and reads it whole, through the Trip store.
 * Changes to one Trip are then applied one at a time, so no check races another change: e.g.
 * an Expense referencing a Participant that is being removed.
 */
async function lockTrip(tx: Transaction, tripId: string): Promise<WholeTrip> {
  await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for('update');
  const trip = await createTripStore(tx).readTrip(tripId);
  // The Trip link was checked before. Only the operator deletes a Trip (the erasure steps in
  // deploy/osieka-dev), so a push that races that fails here.
  if (!trip) throw new Error(`Trip ${tripId} is gone`);
  return trip;
}

/** Whether `adding` more live Participants would make the Trip's more than `PARTICIPANT_LIMIT`. */
function tooMany({ participants }: TripPeople, adding: number): boolean {
  return participants.length + adding > PARTICIPANT_LIMIT;
}

/** An accepted change's result, naming the Participants it brought back only if there are any. */
function accepted(changeId: string, version: number | null, restored: string[]): ChangeResult {
  const result = { changeId, status: 'accepted', version } as const;
  return restored.length > 0 ? { ...result, restored } : result;
}

/**
 * Records an applied change, with the Participants it brought back, and bumps the Trip
 * version, in the transaction that applied it. A retry racing this one may have recorded it
 * first; it was applied either way.
 */
async function recordChange(
  tx: Transaction,
  change: SyncChange,
  tripId: string,
  subjectId: string,
  version: number | null,
  restored: string[] = [],
): Promise<void> {
  const { id, claimId, deviceId } = change;
  await tx
    .insert(changes)
    .values({
      id,
      tripId,
      subjectId,
      version,
      restored: restored.length > 0 ? restored : null,
      claimId,
      deviceId,
    })
    .onConflictDoNothing();
  await tx
    .update(trips)
    .set({ version: sql`${trips.version} + 1` })
    .where(eq(trips.id, tripId));
}

/** The whole Trip as the pull returns it, with removed Participants kept apart. */
function serverTripOf({ participants, ...trip }: WholeTrip): ServerTrip {
  return { ...trip, ...tripPeople(participants) };
}
