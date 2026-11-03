import { expenseIdSchema, type RevisionsResponse } from '@osi/owe-yeah-domain';
import { defineEventHandler, getRouterParam } from 'nuxt/server';
import { tripStore } from '../../../../../trip';
import { requireTrip } from '../../../../../utils/trip-access';

/**
 * An Expense's Revisions, newest first, for its History. Read on demand, not pulled with the
 * Trip; empty for an Expense the Trip doesn't have, or an id that is no Expense id.
 */
export default defineEventHandler(async (event): Promise<RevisionsResponse> => {
  const trip = await requireTrip(event);
  const expenseId = expenseIdSchema.safeParse(getRouterParam(event, 'expenseId')).data;
  if (!expenseId) return { revisions: [] };
  return { revisions: await tripStore().revisions(trip.id, expenseId) };
});
