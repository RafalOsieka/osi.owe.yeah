import { tripVersionSchema, type PullResponse } from '@osi/owe-yeah-domain';
import { defineEventHandler, getValidatedQuery } from 'nuxt/server';
import { z } from 'zod';
import { requireTrip } from '../../utils/trip-access';
import { loadTripSnapshot } from '../../utils/trip-snapshot';

/**
 * The whole-Trip pull (ADR 0002): the Trip with its Participants and its Expenses. Given
 * `since`, the Trip version the device has, it answers `trip: null` while the Trip is still
 * at that version.
 */
export default defineEventHandler(async (event): Promise<PullResponse> => {
  const trip = await requireTrip(event);
  const { since } = await getValidatedQuery(
    event,
    z.object({ since: z.coerce.number().pipe(tripVersionSchema).optional() }),
  );
  return { trip: since === trip.version ? null : await loadTripSnapshot(trip) };
});
