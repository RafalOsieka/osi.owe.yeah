import { tripWithParticipantsSchema } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, readValidatedBody, setResponseStatus } from 'nuxt/server';
import { getDb } from '../../db';
import { participants, trips } from '../../db/schema';
import { createTripToken, hashTripToken } from '../../utils/trip-token';

/**
 * Creates a Trip with its first Participants anonymously. Answers with the Trip link's
 * token, the only time it is ever sent: the server keeps just its hash.
 */
export default defineEventHandler(async (event) => {
  const { participants: firstParticipants, ...trip } = await readValidatedBody(
    event,
    tripWithParticipantsSchema,
  );
  const token = createTripToken();

  await getDb().transaction(async (tx) => {
    const created = await tx
      .insert(trips)
      .values({ ...trip, tokenHash: hashTripToken(token) })
      .onConflictDoNothing({ target: trips.id })
      .returning({ id: trips.id });

    if (created.length === 0) {
      throw createError({ status: 409, statusText: 'A Trip with this id already exists' });
    }
    if (firstParticipants.length > 0) {
      await tx
        .insert(participants)
        .values(firstParticipants.map((participant) => ({ ...participant, tripId: trip.id })));
    }
  });

  setResponseStatus(event, 201);
  return { token };
});
