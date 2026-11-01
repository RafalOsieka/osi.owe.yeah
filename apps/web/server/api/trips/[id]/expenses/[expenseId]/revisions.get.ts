import { expenseIdSchema, type RevisionsResponse } from '@osi/owe-yeah-domain';
import { and, desc, eq } from 'drizzle-orm';
import { defineEventHandler, getRouterParam } from 'nuxt/server';
import { getDb } from '../../../../../db';
import { revisions } from '../../../../../db/schema';
import { requireTrip } from '../../../../../utils/trip-access';

/**
 * An Expense's Revisions, newest first, for its History. Read on demand, not pulled with the
 * Trip; empty for an Expense the Trip doesn't have, or an id that is no Expense id.
 */
export default defineEventHandler(async (event): Promise<RevisionsResponse> => {
  const trip = await requireTrip(event);
  const expenseId = expenseIdSchema.safeParse(getRouterParam(event, 'expenseId')).data;
  if (!expenseId) return { revisions: [] };
  const rows = await getDb()
    .select()
    .from(revisions)
    .where(and(eq(revisions.tripId, trip.id), eq(revisions.expenseId, expenseId)))
    .orderBy(desc(revisions.version));
  return {
    revisions: rows.map(({ version, state, deleted, claimId, createdAt }) => ({
      version,
      expense: { ...state, id: expenseId },
      deleted,
      edited: { by: claimId, at: createdAt.toISOString() },
    })),
  };
});
