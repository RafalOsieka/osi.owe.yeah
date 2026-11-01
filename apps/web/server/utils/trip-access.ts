import {
  TRIP_TOKEN_HEADER,
  tripIdSchema,
  tripSchema,
  tripTokenSchema,
  type Trip,
  type TripChange,
} from '@osi/owe-yeah-domain';
import { and, eq } from 'drizzle-orm';
import { createError, getRequestHeader, getRouterParam, type RequestEvent } from 'nuxt/server';
import { getDb } from '../db';
import { trips } from '../db/schema';
import { hashTripToken } from './trip-token';

/** A Trip as the server keeps it: its details and its current version. */
export type StoredTrip = Trip & { version: number };

/**
 * The Trip addressed by the `id` route param, if the Trip link's token in the
 * `x-trip-token` header matches: the only credential (ADR 0001). A missing or wrong token
 * and an unknown Trip are refused alike, so the answer never tells whether a Trip exists.
 */
export async function requireTrip(event: RequestEvent): Promise<StoredTrip> {
  const id = tripIdSchema.safeParse(getRouterParam(event, 'id'));
  const token = getRequestHeader(event, TRIP_TOKEN_HEADER);
  if (!id.success || !token) throw invalidTripLink();

  const [trip] = await getDb()
    .select({ id: trips.id, name: trips.name, currency: trips.currency, version: trips.version })
    .from(trips)
    .where(and(eq(trips.id, id.data), eq(trips.tokenHash, hashTripToken(token))));
  if (!trip) throw invalidTripLink();

  // Narrows the stored currency to a Trip currency.
  return { ...tripSchema.parse(trip), version: trip.version };
}

/**
 * Creates the Trip addressed by the `id` route param under the request's token, unless a
 * Trip with that id (or token) exists already: how a Trip created on a device, maybe
 * offline, reaches the server. A token too weak to be a Trip link is refused; whether the
 * request may then use the Trip is still for `requireTrip` to say.
 */
export async function createTripIfMissing(
  event: RequestEvent,
  details: TripChange['trip'],
): Promise<void> {
  const id = tripIdSchema.safeParse(getRouterParam(event, 'id'));
  if (!id.success) return;
  const token = tripTokenSchema.safeParse(getRequestHeader(event, TRIP_TOKEN_HEADER));
  if (!token.success) {
    throw createError({ status: 400, statusText: 'A Trip link token is 256 random bits' });
  }

  await getDb()
    .insert(trips)
    .values({ id: id.data, ...details, tokenHash: hashTripToken(token.data) })
    .onConflictDoNothing();
}

function invalidTripLink() {
  return createError({ status: 401, statusText: 'Invalid Trip link' });
}
