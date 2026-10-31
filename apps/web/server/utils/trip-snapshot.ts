import {
  storedExpenseSchema,
  type Participant,
  type StoredExpense,
  type Trip,
  type TripSnapshot,
} from '@osi/owe-yeah-domain';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { expenses, participants } from '../db/schema';

/** A Trip's Participants, in the order they were added. */
export function loadParticipants(tripId: string): Promise<Participant[]> {
  return (
    getDb()
      .select({ id: participants.id, name: participants.name })
      .from(participants)
      .where(eq(participants.tripId, tripId))
      // Participants created in one transaction share `createdAt`; their UUIDv7 ids then
      // keep the order the device generated them in.
      .orderBy(asc(participants.createdAt), asc(participants.id))
  );
}

/** An `expenses` row as the domain's stored Expense, checked on the way out. */
export function toStoredExpense(
  row: Pick<typeof expenses.$inferSelect, 'id' | 'version' | 'state'>,
) {
  return storedExpenseSchema.parse({ ...row.state, id: row.id, version: row.version });
}

/** A Trip's Expenses with their versions, in the order they were created. */
async function loadExpenses(tripId: string): Promise<StoredExpense[]> {
  const rows = await getDb()
    .select({ id: expenses.id, version: expenses.version, state: expenses.state })
    .from(expenses)
    .where(eq(expenses.tripId, tripId))
    .orderBy(asc(expenses.createdAt), asc(expenses.id));
  return rows.map(toStoredExpense);
}

/** The whole Trip as the pull returns it. */
export async function loadTripSnapshot(trip: Trip): Promise<TripSnapshot> {
  const [tripParticipants, tripExpenses] = await Promise.all([
    loadParticipants(trip.id),
    loadExpenses(trip.id),
  ]);
  return { ...trip, participants: tripParticipants, expenses: tripExpenses };
}
