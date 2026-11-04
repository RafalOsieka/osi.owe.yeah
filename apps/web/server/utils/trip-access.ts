import { TRIP_TOKEN_HEADER } from '@osi/owe-yeah-domain';
import { createError, getRequestHeader, getRouterParam, type RequestEvent } from 'nuxt/server';
import { tripStore } from '../trip';
import type { StoredTrip } from '../trip/store';

/**
 * The Trip link a request carries: the Trip id in the `id` route param and its token in the
 * `x-trip-token` header; `null` when either is missing.
 */
export function tripLinkOf(event: RequestEvent): { id: string; token: string } | null {
  const id = getRouterParam(event, 'id');
  const token = getRequestHeader(event, TRIP_TOKEN_HEADER);
  return id && token ? { id, token } : null;
}

/**
 * The Trip the request's Trip link (`tripLinkOf`) opens (`TripStore.tripByLink`); refused with
 * 401 otherwise.
 */
export async function requireTrip(event: RequestEvent): Promise<StoredTrip> {
  const link = tripLinkOf(event);
  const trip = link && (await tripStore().tripByLink(link.id, link.token));
  if (!trip) throw invalidTripLink();
  return trip;
}

/** The answer to a request without a valid Trip link, whether or not the Trip exists. */
export function invalidTripLink() {
  return createError({ status: 401, statusText: 'Invalid Trip link' });
}
