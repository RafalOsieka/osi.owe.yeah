import { pushRequestSchema, TRIP_TOKEN_HEADER, type PushResponse } from '@osi/owe-yeah-domain';
import {
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  readValidatedBody,
} from 'nuxt/server';
import { tripSync } from '../../../trip';
import { invalidTripLink } from '../../../utils/trip-access';

/**
 * The sync push over HTTP (`TripSync.push`): the Trip id is the `id` route param and its Trip
 * link's token the `x-trip-token` header. A malformed push is refused as a whole with 400, and
 * one without a valid Trip link with 401.
 */
export default defineEventHandler(async (event): Promise<PushResponse> => {
  const request = await readValidatedBody(event, pushRequestSchema);
  const id = getRouterParam(event, 'id');
  const token = getRequestHeader(event, TRIP_TOKEN_HEADER);
  const response = id && token ? await tripSync().push(id, token, request) : 'invalidLink';
  if (response === 'invalidLink') throw invalidTripLink();
  return response;
});
