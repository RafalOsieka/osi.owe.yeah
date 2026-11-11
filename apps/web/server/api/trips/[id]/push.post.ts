import { pushEnvelopeSchema, type PushResponse } from '@osi/owe-yeah-domain';
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  readValidatedBody,
  useRuntimeConfig,
} from 'nuxt/server';
import { tripSync } from '../../../trip';
import { LruMap } from '../../../utils/lru-map';
import { invalidTripLink, tripLinkOf } from '../../../utils/trip-access';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The Trips each client address has created in its current hour, which starts with the first
 * of them, for the 10,000 addresses seen most recently.
 */
const creations = new LruMap<string, { count: number; since: number }>(10_000);

/**
 * Counts a Trip created from `address`, unless it has created `limit` Trips this hour already.
 * Kept in memory, so a restart starts every count again.
 */
function mayCreateTrip(address: string, limit: number): boolean {
  const now = Date.now();
  const known = creations.get(address);
  const current = known && now - known.since < HOUR_MS ? known : { count: 0, since: now };
  const allowed = current.count < limit;
  creations.set(address, allowed ? { ...current, count: current.count + 1 } : current);
  return allowed;
}

/**
 * The sync push over HTTP (`TripSync.push`), for the request's Trip link (`tripLinkOf`). Only
 * the envelope is read here: a push whose envelope or change ids are unreadable is refused as
 * a whole with 400, and one without a valid Trip link with 401. Trip sync reads each change.
 * A push that would create a Trip gets 429 once its client address, keyed like the rate
 * limiter's (`CF-Connecting-IP`), has created `tripsPerHour` this hour; the device keeps it
 * queued and sends it again later.
 */
export default defineEventHandler(async (event): Promise<PushResponse> => {
  const request = await readValidatedBody(event, pushEnvelopeSchema);
  const link = tripLinkOf(event);
  // Without the header, as without Cloudflare in front, every request counts as one address.
  const address = getRequestHeader(event, 'cf-connecting-ip') ?? '';
  const { tripsPerHour } = useRuntimeConfig();
  const mayCreate = () => mayCreateTrip(address, tripsPerHour);
  const response = link
    ? await tripSync().push(link.id, link.token, request, mayCreate)
    : 'invalidLink';
  if (response === 'invalidLink') throw invalidTripLink();
  if (response === 'tooManyTrips') {
    throw createError({ status: 429, statusText: 'Too many new Trips' });
  }
  return response;
});
