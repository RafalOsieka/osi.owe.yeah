import {
  expenseProblems,
  expensesReferencing,
  pushRequestSchema,
  referencedParticipantIds,
  tripSchema,
  type ChangeResult,
  type Expense,
  type ExpenseChange,
  type ParticipantChange,
  type PushResponse,
  type SyncChange,
  type Trip,
  type TripChange,
} from '@osi/owe-yeah-domain';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { defineEventHandler, readValidatedBody } from 'nuxt/server';
import { getDb } from '../../../db';
import type { Transaction } from '../../../db/client';
import { changes, expenses, participants, revisions, trips } from '../../../db/schema';
import { notifyAffected, type AppliedExpenseChange } from '../../../utils/push';
import { createTripIfMissing, requireTrip } from '../../../utils/trip-access';
import {
  loadParticipants,
  selectStoredExpenses,
  toStoredExpense,
} from '../../../utils/trip-snapshot';

/**
 * The sync push (ADR 0002): applies a device's outbox changes in order and answers with a
 * result per change. A push carrying a Trip change creates the Trip if the server doesn't
 * have it yet. Trip details and Participants are last-write-wins, except that a Participant
 * an Expense references is never removed. A new Trip currency rewrites no Expense (ADR 0003).
 * An Expense change carries the Expense's full new state and the version it was based on; it
 * is accepted only if it follows the Trip's rules and that version is still current, and
 * then kept as a Revision. It brings back any removed
 * Participant it references. Deletes and restores are Expense changes like edits. A change
 * applied before is answered as the first time and not applied again. A malformed push is
 * refused as a whole with 400. Once it has answered, the devices of the Participants the
 * applied Expense changes affect are notified (`notifyAffected`).
 */
export default defineEventHandler(async (event): Promise<PushResponse> => {
  const { changes: pushed } = await readValidatedBody(event, pushRequestSchema);
  const creation = pushed.find((change) => change.kind === 'trip');
  if (creation) await createTripIfMissing(event, creation.trip);
  const { id: tripId } = await requireTrip(event);

  const results: ChangeResult[] = [];
  const applied: AppliedExpenseChange[] = [];
  for (const change of pushed) {
    const { result, fresh } = await applyOnce(change, tripId);
    results.push(result);
    if (fresh && change.kind === 'expense' && result.status === 'accepted' && result.version) {
      applied.push({ change, version: result.version });
    }
  }
  // Fire-and-forget: the device doesn't wait for anyone to be notified.
  void notifyAffected(tripId, applied);
  return { results };
});

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

/** The first result of a change this Trip has applied before, if it has. */
async function appliedBefore(change: SyncChange, tripId: string): Promise<ChangeResult | null> {
  const [applied] = await getDb()
    .select({ version: changes.version })
    .from(changes)
    .where(and(eq(changes.id, change.id), eq(changes.tripId, tripId)));
  return applied ? { changeId: change.id, status: 'accepted', version: applied.version } : null;
}

/**
 * Locks the Trip until the transaction ends and reads its details. Changes to one Trip are
 * then applied one at a time, so no check races another change: e.g. an Expense referencing
 * a Participant that is being removed.
 */
async function lockTrip(tx: Transaction, tripId: string): Promise<Trip> {
  const [trip] = await tx
    .select({ id: trips.id, name: trips.name, currency: trips.currency })
    .from(trips)
    .where(eq(trips.id, tripId))
    .for('update');
  // Narrows the stored currency to a Trip currency.
  return tripSchema.parse(trip);
}

/** A Trip's Expenses as they are now, deleted ones aside. */
async function tripExpenses(tx: Transaction, tripId: string): Promise<Expense[]> {
  const rows = await tx
    .select({ id: expenses.id, state: expenses.state })
    .from(expenses)
    .where(and(eq(expenses.tripId, tripId), not(expenses.deleted)));
  return rows.map(({ id, state }) => ({ ...state, id }));
}

/**
 * Records an applied change and bumps the Trip version, in the transaction that applied
 * it. A retry racing this one may have recorded it first; it was applied either way.
 */
async function record(
  tx: Transaction,
  change: SyncChange,
  tripId: string,
  subjectId: string,
  version: number | null,
): Promise<void> {
  const { id, claimId, deviceId } = change;
  await tx
    .insert(changes)
    .values({ id, tripId, subjectId, version, claimId, deviceId })
    .onConflictDoNothing();
  await tx
    .update(trips)
    .set({ version: sql`${trips.version} + 1` })
    .where(eq(trips.id, tripId));
}

/**
 * A Trip's details, last write wins; who sent the change is who last changed them. A new
 * Trip currency causes no Conflict, as no Expense changes with it.
 */
async function applyTripChange(change: TripChange, tripId: string): Promise<ChangeResult> {
  const changeId = change.id;
  return getDb().transaction(async (tx): Promise<ChangeResult> => {
    await lockTrip(tx, tripId);
    const { name, currency } = change.trip;
    await tx.update(trips).set({ name, currency }).where(eq(trips.id, tripId));
    await record(tx, change, tripId, tripId, null);
    return { changeId, status: 'accepted', version: null };
  });
}

/**
 * Adds, renames, removes or brings back a Participant, last write wins. Removing one that an
 * Expense references (deleted ones aside) is refused, and so is an id another Trip uses.
 */
async function applyParticipantChange(
  change: ParticipantChange,
  tripId: string,
): Promise<ChangeResult> {
  const { id: changeId, participant, removed } = change;
  return getDb().transaction(async (tx): Promise<ChangeResult> => {
    await lockTrip(tx, tripId);
    const referenced =
      removed && expensesReferencing(await tripExpenses(tx, tripId), participant.id) > 0;
    if (referenced) return { changeId, status: 'rejected', problems: ['participantReferenced'] };

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

    await record(tx, change, tripId, participant.id, null);
    return { changeId, status: 'accepted', version: null };
  });
}

/**
 * Creates the Expense (base version `null`) or updates it if it is still at the base
 * version, in one conditional statement so concurrent pushes cannot both win, and adds the
 * Revision it makes. Removed Participants still count as the Trip's, and an Expense that is
 * not deleted brings back those it references. Returns nothing when the change did not
 * apply.
 */
async function applyExpenseChange(
  change: ExpenseChange,
  tripId: string,
): Promise<ChangeResult | null> {
  const { id, ...state } = change.expense;
  const { id: changeId, deleted } = change;
  return getDb().transaction(async (tx): Promise<ChangeResult | null> => {
    const trip = await lockTrip(tx, tripId);
    const known = await loadParticipants(tripId, tx);
    const problems = expenseProblems(change.expense, { ...trip, participants: known });
    if (problems.length > 0) return { changeId, status: 'rejected', problems };

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

    const referenced = referencedParticipantIds(change.expense);
    const restored = deleted
      ? []
      : known.filter((p) => p.removed && referenced.has(p.id)).map((p) => p.id);
    if (restored.length > 0) {
      await tx
        .update(participants)
        .set({ removed: false })
        .where(and(eq(participants.tripId, tripId), inArray(participants.id, restored)));
    }
    await record(tx, change, tripId, id, stored.version);

    const accepted = { changeId, status: 'accepted', version: stored.version } as const;
    return restored.length > 0 ? { ...accepted, restored } : accepted;
  });
}

/**
 * Why an Expense change did not apply: the Expense is not where or at the version expected.
 * A Conflict says who made the current version, by the Claim sent with that change.
 */
async function refusal(change: ExpenseChange, tripId: string): Promise<ChangeResult> {
  const changeId = change.id;
  const [existing] = await selectStoredExpenses().where(eq(expenses.id, change.expense.id));

  if (!existing) return { changeId, status: 'rejected', problems: ['unknownExpense'] };
  if (existing.tripId !== tripId) {
    return { changeId, status: 'rejected', problems: ['expenseIdTaken'] };
  }
  const current = toStoredExpense(existing);
  return { changeId, status: 'conflict', current, currentClaimId: current.edited?.by ?? null };
}
