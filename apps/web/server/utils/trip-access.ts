import { TRIP_TOKEN_HEADER, tripIdSchema, tripSchema, type Trip } from '@osi/owe-yeah-domain';
import { and, eq } from 'drizzle-orm';
import { createError, getRequestHeader, getRouterParam, type RequestEvent } from 'nuxt/server';
import { getDb } from '../db';
import { trips } from '../db/schema';
import { hashTripToken } from './trip-token';

/**
 * The Trip addressed by the `id` route param, if the Trip link's token in the
 * `x-trip-token` header matches: the only credential (ADR 0001). A missing or wrong token
 * and an unknown Trip are refused alike, so the answer never tells whether a Trip exists.
 */
export async function requireTrip(event: RequestEvent): Promise<Trip> {
  const id = tripIdSchema.safeParse(getRouterParam(event, 'id'));
  const token = getRequestHeader(event, TRIP_TOKEN_HEADER);
  if (!id.success || !token) throw invalidTripLink();

  const [trip] = await getDb()
    .select({ id: trips.id, name: trips.name, currency: trips.currency })
    .from(trips)
    .where(and(eq(trips.id, id.data), eq(trips.tokenHash, hashTripToken(token))));
  if (!trip) throw invalidTripLink();

  // Narrows the stored currency to a Trip currency.
  return tripSchema.parse(trip);
}

function invalidTripLink() {
  return createError({ status: 401, statusText: 'Invalid Trip link' });
}
