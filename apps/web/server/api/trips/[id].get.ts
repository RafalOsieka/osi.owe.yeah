import type { TripWithParticipants } from '@osi/owe-yeah-domain';
import { asc, eq } from 'drizzle-orm';
import { defineEventHandler } from 'nuxt/server';
import { getDb } from '../../db';
import { participants } from '../../db/schema';
import { requireTrip } from '../../utils/trip-access';

/** The whole-Trip pull: the Trip with its Participants, in the order they were added. */
export default defineEventHandler(async (event): Promise<TripWithParticipants> => {
  const trip = await requireTrip(event);

  const tripParticipants = await getDb()
    .select({ id: participants.id, name: participants.name })
    .from(participants)
    .where(eq(participants.tripId, trip.id))
    // Participants created in one transaction share `createdAt`; their UUIDv7 ids then
    // keep the order the device generated them in.
    .orderBy(asc(participants.createdAt), asc(participants.id));

  return { ...trip, participants: tripParticipants };
});
