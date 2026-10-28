import { tripSchema } from '@osi/owe-yeah-domain';
import { getDb } from '../../db';
import { trips } from '../../db/schema';
import { createTripToken, hashTripToken } from '../../utils/trip-token';

/**
 * Creates a Trip anonymously. Answers with the Trip link's token, the only time it is
 * ever sent: the server keeps just its hash.
 */
export default defineEventHandler(async (event) => {
  const trip = await readValidatedBody(event, tripSchema.parse);
  const token = createTripToken();

  const created = await getDb()
    .insert(trips)
    .values({ ...trip, tokenHash: hashTripToken(token) })
    .onConflictDoNothing({ target: trips.id })
    .returning({ id: trips.id });

  if (created.length === 0) {
    throw createError({ statusCode: 409, statusMessage: 'A Trip with this id already exists' });
  }

  setResponseStatus(event, 201);
  return { token };
});
