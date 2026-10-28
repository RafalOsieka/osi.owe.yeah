import { participantSchema, type Participant } from '@osi/owe-yeah-domain';
import { eq } from 'drizzle-orm';
import { createError, defineEventHandler, readValidatedBody, setResponseStatus } from 'nuxt/server';
import { getDb } from '../../../db';
import { participants } from '../../../db/schema';
import { requireTrip } from '../../../utils/trip-access';

/**
 * Adds a Participant to a Trip. The id comes from the device, so a retry of the same
 * addition succeeds without adding the Participant twice; a resent name wins, as
 * Participants are last-write-wins (ADR 0002). Answers with the stored Participant.
 */
export default defineEventHandler(async (event): Promise<Participant> => {
  const trip = await requireTrip(event);
  const participant = await readValidatedBody(event, participantSchema);

  // An id another Trip uses is left alone: the update is limited to this Trip's row.
  const [stored] = await getDb()
    .insert(participants)
    .values({ ...participant, tripId: trip.id })
    .onConflictDoUpdate({
      target: participants.id,
      set: { name: participant.name },
      setWhere: eq(participants.tripId, trip.id),
    })
    .returning({ id: participants.id, name: participants.name });
  if (!stored) {
    throw createError({ status: 409, statusText: 'A Participant with this id already exists' });
  }

  setResponseStatus(event, 201);
  return stored;
});
