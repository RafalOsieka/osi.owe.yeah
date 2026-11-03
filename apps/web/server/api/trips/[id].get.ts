import { tripVersionSchema, type PullResponse, type TripSnapshot } from '@osi/owe-yeah-domain';
import { defineEventHandler, getValidatedQuery } from 'nuxt/server';
import { z } from 'zod';
import { tripRates, tripStore } from '../../trip';
import type { StoredParticipant, WholeTrip } from '../../trip/store';
import { invalidTripLink, requireTrip } from '../../utils/trip-access';

/**
 * The whole-Trip pull (ADR 0002): the Trip with its Participants and its Expenses. Given
 * `since`, the Trip version the device has, it answers `trip: null` while the Trip is still
 * at that version. Either way it brings the rate entries the Trip's Expenses need, filling
 * the rate table as it goes (ADR 0003): rates become fixed without the Trip changing.
 */
export default defineEventHandler(async (event): Promise<PullResponse> => {
  const { id } = await requireTrip(event);
  const { since } = await getValidatedQuery(
    event,
    z.object({ since: z.coerce.number().pipe(tripVersionSchema).optional() }),
  );
  const trip = await tripStore().readTrip(id);
  if (!trip) throw invalidTripLink();
  return {
    trip: since === trip.version ? null : pulled(trip),
    rates: await tripRates().forTrip(trip),
  };
});

/** The whole Trip as the pull returns it, with removed Participants kept apart. */
function pulled({ participants, ...trip }: WholeTrip): TripSnapshot {
  const shown = ({ id, name }: StoredParticipant) => ({ id, name });
  return {
    ...trip,
    participants: participants.filter(({ removed }) => !removed).map(shown),
    removedParticipants: participants.filter(({ removed }) => removed).map(shown),
  };
}
