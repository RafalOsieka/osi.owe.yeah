import { tripVersionSchema, type PullResponse } from '@osi/owe-yeah-domain';
import { defineEventHandler, getValidatedQuery } from 'nuxt/server';
import { z } from 'zod';
import { tripSync } from '../../trip';
import { invalidTripLink, tripLinkOf } from '../../utils/trip-access';

/**
 * The whole-Trip pull over HTTP (`TripSync.pull`), for the request's Trip link (`tripLinkOf`)
 * and `since`, the Trip version the device has. Refused with 401 without a valid Trip link.
 */
export default defineEventHandler(async (event): Promise<PullResponse> => {
  const { since } = await getValidatedQuery(
    event,
    z.object({ since: z.coerce.number().pipe(tripVersionSchema).optional() }),
  );
  const link = tripLinkOf(event);
  const response = link ? await tripSync().pull(link.id, link.token, since) : 'invalidLink';
  if (response === 'invalidLink') throw invalidTripLink();
  return response;
});
