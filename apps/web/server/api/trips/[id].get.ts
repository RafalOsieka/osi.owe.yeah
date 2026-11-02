import { tripVersionSchema, type PullResponse } from '@osi/owe-yeah-domain';
import { defineEventHandler, getValidatedQuery } from 'nuxt/server';
import { z } from 'zod';
import { loadTripRates } from '../../utils/rates';
import { requireTrip } from '../../utils/trip-access';
import { loadTripSnapshot } from '../../utils/trip-snapshot';

/**
 * The whole-Trip pull (ADR 0002): the Trip with its Participants and its Expenses. Given
 * `since`, the Trip version the device has, it answers `trip: null` while the Trip is still
 * at that version. Either way it brings the rate entries the Trip's Expenses need, filling
 * the rate table as it goes (ADR 0003): rates become fixed without the Trip changing.
 */
export default defineEventHandler(async (event): Promise<PullResponse> => {
  const trip = await requireTrip(event);
  const { since } = await getValidatedQuery(
    event,
    z.object({ since: z.coerce.number().pipe(tripVersionSchema).optional() }),
  );
  const [snapshot, rates] = await Promise.all([
    since === trip.version ? null : loadTripSnapshot(trip),
    loadTripRates(trip),
  ]);
  return { trip: snapshot, rates };
});
