import { TRIP_TOKEN_HEADER } from '@osi/owe-yeah-domain';
import { createError, getRequestHeader, getRouterParam, type RequestEvent } from 'nuxt/server';
import { tripStore } from '../trip';
import type { StoredTrip } from '../trip/store';

/**
 * The Trip addressed by the `id` route param, if the Trip link's token in the
 * `x-trip-token` header matches (`TripStore.tripByLink`); refused with 401 otherwise.
 */
export async function requireTrip(event: RequestEvent): Promise<StoredTrip> {
  const id = getRouterParam(event, 'id');
  const token = getRequestHeader(event, TRIP_TOKEN_HEADER);
  const trip = id && token ? await tripStore().tripByLink(id, token) : null;
  if (!trip) throw invalidTripLink();
  return trip;
}

/** The answer to a request without a valid Trip link, whether or not the Trip exists. */
export function invalidTripLink() {
  return createError({ status: 401, statusText: 'Invalid Trip link' });
}
