import { and, eq } from 'drizzle-orm';
import { defineEventHandler } from 'nuxt/server';
import { getDb } from '../../../../db';
import { pushSubscriptions } from '../../../../db/schema';
import { requireDeviceId } from '../../../../utils/push';
import { requireTrip } from '../../../../utils/trip-access';

/**
 * Deletes a device's push subscription to the Trip (#41): it turned notifications off or
 * forgot the Trip. Deleting one the server doesn't have is fine, so a retry is too.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const deviceId = requireDeviceId(event);
  await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tripId, trip.id), eq(pushSubscriptions.deviceId, deviceId)));
  event.res.status = 204;
});
