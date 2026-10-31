import type { TripSnapshot } from '@osi/owe-yeah-domain';
import { defineEventHandler } from 'nuxt/server';
import { requireTrip } from '../../utils/trip-access';
import { loadTripSnapshot } from '../../utils/trip-snapshot';

/** The whole-Trip pull: the Trip with its Participants and its Expenses (ADR 0002). */
export default defineEventHandler(async (event): Promise<TripSnapshot> => {
  return loadTripSnapshot(await requireTrip(event));
});
