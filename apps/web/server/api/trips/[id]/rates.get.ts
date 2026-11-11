import { rateQuerySchema, type RateLookup } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server';
import { tripRates } from '../../../trip';
import { requireTrip } from '../../../utils/trip-access';

/**
 * The automatic rate of `from` in the Trip's own currency on `date` (a local date), for the
 * Expense form to convert with before the Expense is saved and pulled (ADR 0003), or why there
 * is none (`RateLookup`). Waits for the server's rate table to be filled with it. Refused with 401
 * without a valid Trip link, and with 400 for the Trip currency itself.
 */
export default defineEventHandler(async (event): Promise<RateLookup> => {
  const trip = await requireTrip(event);
  const { from, date } = await getValidatedQuery(event, rateQuerySchema);
  if (from === trip.currency) {
    throw createError({ status: 400, statusText: 'No rate of the Trip currency in itself' });
  }
  return tripRates().lookup(date, from, trip.currency);
});
