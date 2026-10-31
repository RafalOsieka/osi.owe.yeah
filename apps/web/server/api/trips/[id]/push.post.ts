import {
  expenseProblems,
  pushRequestSchema,
  type ChangeResult,
  type ExpenseChange,
  type PushResponse,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { and, eq, sql } from 'drizzle-orm';
import { defineEventHandler, readValidatedBody } from 'nuxt/server';
import { getDb } from '../../../db';
import { expenses } from '../../../db/schema';
import { requireTrip } from '../../../utils/trip-access';
import { loadParticipants, toStoredExpense } from '../../../utils/trip-snapshot';

/**
 * The sync push (ADR 0002): applies each change to an Expense in order and answers with a
 * result per change. A change carries the Expense's full new state and the version it was
 * based on; it is accepted only if it follows the Trip's rules and that version is still
 * current. A malformed push is refused as a whole with 400.
 */
export default defineEventHandler(async (event): Promise<PushResponse> => {
  const trip = await requireTrip(event);
  const { changes } = await readValidatedBody(event, pushRequestSchema);
  const snapshot = { ...trip, participants: await loadParticipants(trip.id) };

  const results: ChangeResult[] = [];
  for (const change of changes) results.push(await apply(change, snapshot));
  return { results };
});

async function apply(change: ExpenseChange, trip: TripWithParticipants): Promise<ChangeResult> {
  const changeId = change.id;
  const problems = expenseProblems(change.expense, trip);
  if (problems.length > 0) return { changeId, status: 'rejected', problems };

  const applied = await write(change, trip.id);
  if (applied) return { changeId, status: 'accepted', version: applied.version };

  // Not applied: the Expense is not where or at the version the change expected.
  const [existing] = await getDb()
    .select({
      id: expenses.id,
      tripId: expenses.tripId,
      version: expenses.version,
      lastChangeId: expenses.lastChangeId,
      state: expenses.state,
    })
    .from(expenses)
    .where(eq(expenses.id, change.expense.id));

  if (!existing) return { changeId, status: 'rejected', problems: ['unknownExpense'] };
  if (existing.tripId !== trip.id) {
    return { changeId, status: 'rejected', problems: ['expenseIdTaken'] };
  }
  // A retry of the change that produced the current version: answer as the first time.
  if (existing.lastChangeId === changeId) {
    return { changeId, status: 'accepted', version: existing.version };
  }
  return { changeId, status: 'conflict', current: toStoredExpense(existing) };
}

/**
 * Creates the Expense (base version `null`) or updates it if it is still at the base
 * version, in one conditional statement so concurrent pushes cannot both win. Returns the
 * new version, or nothing when the change did not apply.
 */
async function write(change: ExpenseChange, tripId: string) {
  const { id, ...state } = change.expense;
  const db = getDb();

  if (change.baseVersion === null) {
    const [created] = await db
      .insert(expenses)
      .values({ id, tripId, version: 1, lastChangeId: change.id, state })
      .onConflictDoNothing({ target: expenses.id })
      .returning({ version: expenses.version });
    return created;
  }

  const [updated] = await db
    .update(expenses)
    .set({ version: sql`${expenses.version} + 1`, lastChangeId: change.id, state })
    .where(
      and(
        eq(expenses.id, id),
        eq(expenses.tripId, tripId),
        eq(expenses.version, change.baseVersion),
      ),
    )
    .returning({ version: expenses.version });
  return updated;
}
