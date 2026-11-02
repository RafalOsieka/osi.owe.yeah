import {
  storedExpenseSchema,
  type Edited,
  type Participant,
  type StoredExpense,
  type TripSnapshot,
} from '@osi/owe-yeah-domain';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import type { Database, Transaction } from '../db/client';
import { changes, expenses, participants, revisions } from '../db/schema';
import type { StoredTrip } from './trip-access';

/** A Participant as the server keeps them: removed ones are kept, softly. */
export type StoredParticipant = Participant & { removed: boolean };

/** A Trip's Participants, removed ones included, in the order they were added. */
export function loadParticipants(
  tripId: string,
  db: Database | Transaction = getDb(),
): Promise<StoredParticipant[]> {
  return (
    db
      .select({ id: participants.id, name: participants.name, removed: participants.removed })
      .from(participants)
      .where(eq(participants.tripId, tripId))
      // Participants created in one transaction share `createdAt`; their UUIDv7 ids then
      // keep the order the device generated them in.
      .orderBy(asc(participants.createdAt), asc(participants.id))
  );
}

/**
 * Expenses, deleted ones included, each with the Revision of the version it is at: who made
 * it and when. Narrow it with `where`; read rows with `toStoredExpense`.
 */
export function selectStoredExpenses() {
  return getDb()
    .select({
      id: expenses.id,
      tripId: expenses.tripId,
      version: expenses.version,
      state: expenses.state,
      deleted: expenses.deleted,
      editedBy: revisions.claimId,
      editedAt: revisions.createdAt,
    })
    .from(expenses)
    .leftJoin(
      revisions,
      and(eq(revisions.expenseId, expenses.id), eq(revisions.version, expenses.version)),
    );
}

type StoredExpenseRow = Awaited<ReturnType<typeof selectStoredExpenses>>[number];

/** A `selectStoredExpenses` row as the domain's stored Expense, checked on the way out. */
export function toStoredExpense(row: StoredExpenseRow): StoredExpense {
  const { id, version, state, deleted, editedBy, editedAt } = row;
  return storedExpenseSchema.parse({
    ...state,
    id,
    version,
    deleted,
    edited: editedAt && { by: editedBy, at: editedAt.toISOString() },
  });
}

/** A Trip's Expenses with their versions, deleted ones included, in the order they were created. */
async function loadExpenses(tripId: string): Promise<StoredExpense[]> {
  const rows = await selectStoredExpenses()
    .where(eq(expenses.tripId, tripId))
    .orderBy(asc(expenses.createdAt), asc(expenses.id));
  return rows.map(toStoredExpense);
}

/**
 * Who last changed the Trip's details and when: the Claim sent with the latest Trip change,
 * its creation included. `null` for a Trip without one.
 */
async function loadTripEdited(tripId: string): Promise<Edited | null> {
  const [latest] = await getDb()
    .select({ by: changes.claimId, at: changes.createdAt })
    .from(changes)
    .where(and(eq(changes.tripId, tripId), eq(changes.subjectId, tripId)))
    .orderBy(desc(changes.createdAt), desc(changes.id))
    .limit(1);
  return latest ? { by: latest.by, at: latest.at.toISOString() } : null;
}

/** The whole Trip as the pull returns it, at the version `trip` was read at. */
export async function loadTripSnapshot(trip: StoredTrip): Promise<TripSnapshot> {
  const [tripParticipants, tripExpenses, edited] = await Promise.all([
    loadParticipants(trip.id),
    loadExpenses(trip.id),
    loadTripEdited(trip.id),
  ]);
  const shown = ({ id, name }: StoredParticipant): Participant => ({ id, name });
  return {
    ...trip,
    edited,
    participants: tripParticipants.filter(({ removed }) => !removed).map(shown),
    removedParticipants: tripParticipants.filter(({ removed }) => removed).map(shown),
    expenses: tripExpenses,
  };
}
