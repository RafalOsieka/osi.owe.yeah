import { subscriptionRequestSchema } from '@osi/owe-yeah-domain';
import { and, eq, ne } from 'drizzle-orm';
import {
  createError,
  defineEventHandler,
  getRouterParam,
  readValidatedBody,
  useRuntimeConfig,
} from 'nuxt/server';
import { z } from 'zod';
import { getDb } from '../../../../db';
import { notificationSubscriptions, trips } from '../../../../db/schema';
import { isKnownPushService } from '../../../../notifications/push-services';
import { requireTrip } from '../../../../utils/trip-access';

// How many devices' subscriptions a Trip keeps at most, so a Notification reaches a bounded
// number of push services.
const SUBSCRIPTION_LIMIT = 200;

/**
 * Registers a device's subscription to Notifications in the Trip (#41), or replaces it: with
 * the Claim it has now, so it follows a changed Claim. The device sends it again until it gets
 * through. The `deviceId` route param is the device's opaque id, the one its changes carry.
 * Only an endpoint at a known push service is taken (`isKnownPushService`); a refused one
 * logs its host, so a push service missing from the list shows up. A new device past
 * `SUBSCRIPTION_LIMIT` gets 409, and the device keeps sending it, as it does any refusal. The
 * Trip is locked while it is counted, so devices subscribing at once can't pass it together.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const deviceId = z.uuid().safeParse(getRouterParam(event, 'deviceId'));
  if (!deviceId.success) throw createError({ status: 400, statusText: 'Invalid device id' });
  const { endpoint, keys, claimId } = await readValidatedBody(event, subscriptionRequestSchema);
  if (!useRuntimeConfig().notificationsAnyEndpoint && !isKnownPushService(endpoint)) {
    console.warn(`A push endpoint at an unknown host was refused: ${new URL(endpoint).host}`);
    throw createError({ status: 400, statusText: 'Not a known push service' });
  }

  const subscription = { endpoint, p256dh: keys.p256dh, auth: keys.auth, claimId };
  await getDb().transaction(async (tx) => {
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, trip.id)).for('update');
    const others = await tx.$count(
      notificationSubscriptions,
      and(
        eq(notificationSubscriptions.tripId, trip.id),
        ne(notificationSubscriptions.deviceId, deviceId.data),
      ),
    );
    if (others >= SUBSCRIPTION_LIMIT) {
      throw createError({ status: 409, statusText: 'Too many subscriptions in the Trip' });
    }
    await tx
      .insert(notificationSubscriptions)
      .values({ tripId: trip.id, deviceId: deviceId.data, ...subscription })
      .onConflictDoUpdate({
        target: [notificationSubscriptions.tripId, notificationSubscriptions.deviceId],
        set: subscription,
      });
  });
  event.res.status = 204;
});
