import { TRIP_TOKEN_HEADER, tripVersionSchema, type PullResponse } from '@osi/owe-yeah-domain';
import {
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  getValidatedQuery,
} from 'nuxt/server';
import { z } from 'zod';
import { tripSync } from '../../trip';
import { invalidTripLink } from '../../utils/trip-access';

/**
 * The whole-Trip pull over HTTP (`TripSync.pull`): the Trip id is the `id` route param, its
 * Trip link's token the `x-trip-token` header, and `since` the Trip version the device has.
 * Refused with 401 without a valid Trip link.
 */
export default defineEventHandler(async (event): Promise<PullResponse> => {
  const { since } = await getValidatedQuery(
    event,
    z.object({ since: z.coerce.number().pipe(tripVersionSchema).optional() }),
  );
  const id = getRouterParam(event, 'id');
  const token = getRequestHeader(event, TRIP_TOKEN_HEADER);
  const response = id && token ? await tripSync().pull(id, token, since) : 'invalidLink';
  if (response === 'invalidLink') throw invalidTripLink();
  return response;
});
