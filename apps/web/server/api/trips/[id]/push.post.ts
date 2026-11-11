import { pushEnvelopeSchema, type PushResponse } from '@osi/owe-yeah-domain';
import { defineEventHandler, readValidatedBody } from 'nuxt/server';
import { tripSync } from '../../../trip';
import { invalidTripLink, tripLinkOf } from '../../../utils/trip-access';

/**
 * The sync push over HTTP (`TripSync.push`), for the request's Trip link (`tripLinkOf`). Only
 * the envelope is read here: a push whose envelope or change ids are unreadable is refused as
 * a whole with 400, and one without a valid Trip link with 401. Trip sync reads each change.
 */
export default defineEventHandler(async (event): Promise<PushResponse> => {
  const request = await readValidatedBody(event, pushEnvelopeSchema);
  const link = tripLinkOf(event);
  const response = link ? await tripSync().push(link.id, link.token, request) : 'invalidLink';
  if (response === 'invalidLink') throw invalidTripLink();
  return response;
});
