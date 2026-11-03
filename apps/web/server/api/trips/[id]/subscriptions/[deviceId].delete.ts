import { and, eq } from 'drizzle-orm';
import { createError, defineEventHandler, getRouterParam } from 'nuxt/server';
import { z } from 'zod';
import { getDb } from '../../../../db';
import { notificationSubscriptions } from '../../../../db/schema';
import { requireTrip } from '../../../../utils/trip-access';

/**
 * Deletes a device's subscription to Notifications in the Trip (#41): it turned notifications
 * off or forgot the Trip. Deleting one the server doesn't have is fine, so a retry is too. The
 * `deviceId` route param is the device's opaque id, the one its changes carry.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const deviceId = z.uuid().safeParse(getRouterParam(event, 'deviceId'));
  if (!deviceId.success) throw createError({ status: 400, statusText: 'Invalid device id' });
  await getDb()
    .delete(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.tripId, trip.id),
        eq(notificationSubscriptions.deviceId, deviceId.data),
      ),
    );
  event.res.status = 204;
});
