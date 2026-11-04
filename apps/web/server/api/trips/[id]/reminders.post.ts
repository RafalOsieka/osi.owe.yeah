import { reminderRequestSchema, type ReminderRefusal } from '@osi/owe-yeah-domain';
import { defineEventHandler, readValidatedBody } from 'nuxt/server';
import { reminders } from '../../../trip';
import { requireTrip } from '../../../utils/trip-access';

// The status each refusal is answered with; the body names it, as a proxy answers these too.
const refusalStatus = {
  notSuggested: 403,
  unreachable: 409,
  remindedToday: 429,
} satisfies Record<ReminderRefusal['refused'], number>;

/**
 * Sends a Reminder by hand (#42), a call of its own and never a change in the outbox: the
 * creditor of a current suggestion reminds its debtor, at most once a day.
 * Answers 204 once it is on its way, or the refusal (`ReminderRefusal`) with its status.
 */
export default defineEventHandler(async (event): Promise<ReminderRefusal | undefined> => {
  const trip = await requireTrip(event);
  const request = await readValidatedBody(event, reminderRequestSchema);
  const refusal = await reminders().send(trip.id, request);
  event.res.status = refusal ? refusalStatus[refusal.refused] : 204;
  return refusal;
});
