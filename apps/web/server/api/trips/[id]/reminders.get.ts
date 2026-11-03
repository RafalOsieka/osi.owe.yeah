import type { ReminderStatus } from '@osi/owe-yeah-domain';
import { defineEventHandler } from 'nuxt/server';
import { reminderStatus } from '../../../utils/reminders';
import { requireTrip } from '../../../utils/trip-access';

/**
 * What a creditor's device shows on its Remind buttons before they are tapped (#42): whom a
 * Reminder can reach, and the pairs reminded today (`reminderStatus`).
 */
export default defineEventHandler(async (event): Promise<ReminderStatus> => {
  const trip = await requireTrip(event);
  return reminderStatus(trip.id);
});
