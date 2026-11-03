import { subscriptionRequestSchema } from '@osi/owe-yeah-domain';
import {
  createError,
  defineEventHandler,
  getRouterParam,
  readValidatedBody,
  useRuntimeConfig,
} from 'nuxt/server';
import { z } from 'zod';
import { getDb } from '../../../../db';
import { notificationSubscriptions } from '../../../../db/schema';
import { requireTrip } from '../../../../utils/trip-access';

/**
 * Registers a device's subscription to Notifications in the Trip (#41), or replaces it: with
 * the Claim it has now, so it follows a changed Claim. The device sends it again until it gets
 * through. The `deviceId` route param is the device's opaque id, the one its changes carry.
 * Only an https endpoint is taken, as every push service has one.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const deviceId = z.uuid().safeParse(getRouterParam(event, 'deviceId'));
  if (!deviceId.success) throw createError({ status: 400, statusText: 'Invalid device id' });
  const { endpoint, keys, claimId } = await readValidatedBody(event, subscriptionRequestSchema);
  const secure = new URL(endpoint).protocol === 'https:';
  if (!secure && !useRuntimeConfig().pushAllowHttp) {
    throw createError({ status: 400, statusText: 'A push endpoint is https' });
  }

  const subscription = { endpoint, p256dh: keys.p256dh, auth: keys.auth, claimId };
  await getDb()
    .insert(notificationSubscriptions)
    .values({ tripId: trip.id, deviceId: deviceId.data, ...subscription })
    .onConflictDoUpdate({
      target: [notificationSubscriptions.tripId, notificationSubscriptions.deviceId],
      set: subscription,
    });
  event.res.status = 204;
});
