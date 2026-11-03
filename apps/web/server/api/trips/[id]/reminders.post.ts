import { reminderRequestSchema } from '@osi/owe-yeah-domain';
import { defineEventHandler, readValidatedBody } from 'nuxt/server';
import { reminders } from '../../../trip';
import { requireTrip } from '../../../utils/trip-access';

/**
 * Sends a Reminder by hand (#42), a call of its own and never a change in the outbox: the
 * creditor of a current suggestion reminds its debtor, at most once a day.
 * Answers 204 once it is on its way.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const request = await readValidatedBody(event, reminderRequestSchema);
  await reminders().send(trip.id, request);
  event.res.status = 204;
});
