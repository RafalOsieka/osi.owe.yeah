import { subscriptionRequestSchema } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, readValidatedBody, useRuntimeConfig } from 'nuxt/server';
import { getDb } from '../../../../db';
import { pushSubscriptions } from '../../../../db/schema';
import { requireDeviceId } from '../../../../utils/push';
import { requireTrip } from '../../../../utils/trip-access';

/**
 * Registers a device's push subscription to the Trip (#41), or replaces it: with the Claim it
 * has now, so it follows a changed Claim. The device sends it again until it gets through.
 * Only an https endpoint is taken, as every push service has one.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const deviceId = requireDeviceId(event);
  const { endpoint, keys, claimId } = await readValidatedBody(event, subscriptionRequestSchema);
  const secure = new URL(endpoint).protocol === 'https:';
  if (!secure && !useRuntimeConfig().pushAllowHttp) {
    throw createError({ status: 400, statusText: 'A push endpoint is https' });
  }

  const subscription = { endpoint, p256dh: keys.p256dh, auth: keys.auth, claimId };
  await getDb()
    .insert(pushSubscriptions)
    .values({ tripId: trip.id, deviceId, ...subscription })
    .onConflictDoUpdate({
      target: [pushSubscriptions.tripId, pushSubscriptions.deviceId],
      set: subscription,
    });
  event.res.status = 204;
});
