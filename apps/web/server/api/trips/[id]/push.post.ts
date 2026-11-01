import {
  expenseProblems,
  pushRequestSchema,
  type ChangeResult,
  type ExpenseChange,
  type Participant,
  type ParticipantChange,
  type PushResponse,
  type SyncChange,
  type TripChange,
} from '@osi/owe-yeah-domain';
import { and, eq, sql } from 'drizzle-orm';
import { defineEventHandler, readValidatedBody } from 'nuxt/server';
import { getDb } from '../../../db';
import type { Database } from '../../../db/client';
import { changes, expenses, participants, revisions, trips } from '../../../db/schema';
import { createTripIfMissing, requireTrip, type StoredTrip } from '../../../utils/trip-access';
import {
  loadParticipants,
  selectStoredExpenses,
  toStoredExpense,
} from '../../../utils/trip-snapshot';

/**
 * The sync push (ADR 0002): applies a device's outbox changes in order and answers with a
 * result per change. A push carrying a Trip change creates the Trip if the server doesn't
 * have it yet. Trip details and Participants are last-write-wins. An Expense change carries
 * the Expense's full new state and the version it was based on; it is accepted only if it
 * follows the Trip's rules and that version is still current, and then kept as a Revision.
 * Deletes and restores are Expense changes like edits. A change applied before is
 * answered as the first time and not applied again. A malformed push is refused as a whole
 * with 400.
 */
export default defineEventHandler(async (event): Promise<PushResponse> => {
  const { changes: pushed } = await readValidatedBody(event, pushRequestSchema);
  const creation = pushed.find((change) => change.kind === 'trip');
  if (creation) await createTripIfMissing(event, creation.trip);
  const trip = await requireTrip(event);
  const known = await loadParticipants(trip.id);

  const results: ChangeResult[] = [];
  for (const change of pushed) results.push(await applyOnce(change, trip, known));
  return { results };
});

/**
 * Applies one change unless it was applied before. `known` is the Trip's Participants,
 * kept up to date as Participant changes are applied, so a later Expense in the same push
 * may use them.
 */
async function applyOnce(
  change: SyncChange,
  trip: StoredTrip,
  known: Participant[],
): Promise<ChangeResult> {
  const before = await appliedBefore(change, trip.id);
  if (before) return before;

  switch (change.kind) {
    case 'trip':
      return applyTripChange(change, trip.id);
    case 'participant':
      return applyParticipantChange(change, trip.id, known);
    case 'expense':
      return (
        (await applyExpenseChange(change, { ...trip, participants: known })) ??
        // Not applied, unless a retry of the same change racing this one applied it.
        (await appliedBefore(change, trip.id)) ??
        (await refusal(change, trip.id))
      );
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

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

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
 * A Trip's details, last write wins. Only the name changes: the Trip currency is set when
 * the Trip is created, as changing it means converting its Expenses.
 */
async function applyTripChange(change: TripChange, tripId: string): Promise<ChangeResult> {
  await getDb().transaction(async (tx) => {
    await tx.update(trips).set({ name: change.trip.name }).where(eq(trips.id, tripId));
    await record(tx, change, tripId, tripId, null);
  });
  return { changeId: change.id, status: 'accepted', version: null };
}

/** Adds or renames a Participant, last write wins. An id another Trip uses is refused. */
async function applyParticipantChange(
  change: ParticipantChange,
  tripId: string,
  known: Participant[],
): Promise<ChangeResult> {
  const { participant } = change;
  const stored = await getDb().transaction(async (tx) => {
    // An id another Trip uses is left alone: the update is limited to this Trip's row.
    const [upserted] = await tx
      .insert(participants)
      .values({ ...participant, tripId })
      .onConflictDoUpdate({
        target: participants.id,
        set: { name: participant.name },
        setWhere: eq(participants.tripId, tripId),
      })
      .returning({ id: participants.id });
    if (upserted) await record(tx, change, tripId, participant.id, null);
    return upserted;
  });
  if (!stored) return { changeId: change.id, status: 'rejected', problems: ['participantIdTaken'] };

  const index = known.findIndex(({ id }) => id === participant.id);
  if (index < 0) known.push(participant);
  else known[index] = participant;
  return { changeId: change.id, status: 'accepted', version: null };
}

/**
 * Creates the Expense (base version `null`) or updates it if it is still at the base
 * version, in one conditional statement so concurrent pushes cannot both win, and adds the
 * Revision it makes. Returns nothing when the change did not apply.
 */
async function applyExpenseChange(
  change: ExpenseChange,
  trip: StoredTrip & { participants: Participant[] },
): Promise<ChangeResult | null> {
  const problems = expenseProblems(change.expense, trip);
  if (problems.length > 0) return { changeId: change.id, status: 'rejected', problems };

  const { id, ...state } = change.expense;
  const { deleted } = change;
  const applied = await getDb().transaction(async (tx) => {
    const [stored] =
      change.baseVersion === null
        ? await tx
            .insert(expenses)
            .values({ id, tripId: trip.id, version: 1, state, deleted })
            .onConflictDoNothing({ target: expenses.id })
            .returning({ version: expenses.version })
        : await tx
            .update(expenses)
            .set({ version: sql`${expenses.version} + 1`, state, deleted })
            .where(
              and(
                eq(expenses.id, id),
                eq(expenses.tripId, trip.id),
                eq(expenses.version, change.baseVersion),
              ),
            )
            .returning({ version: expenses.version });
    if (!stored) return undefined;
    await tx.insert(revisions).values({
      expenseId: id,
      version: stored.version,
      tripId: trip.id,
      state,
      deleted,
      claimId: change.claimId,
      deviceId: change.deviceId,
    });
    await record(tx, change, trip.id, id, stored.version);
    return stored;
  });
  return applied ? { changeId: change.id, status: 'accepted', version: applied.version } : null;
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
