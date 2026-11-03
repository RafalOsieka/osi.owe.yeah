import { reminderRequestSchema } from '@osi/owe-yeah-domain';
import { defineEventHandler, readValidatedBody } from 'nuxt/server';
import { sendReminder } from '../../../utils/reminders';
import { requireTrip } from '../../../utils/trip-access';

/**
 * Sends a Reminder by hand (#42), a call of its own and never a change in the outbox: the
 * creditor of a current suggestion reminds its debtor, at most once a day (`sendReminder`).
 * Answers 204 once it is on its way.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const request = await readValidatedBody(event, reminderRequestSchema);
  await sendReminder(trip, request);
  event.res.status = 204;
});
