import { subscriptionRequestSchema } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server';
import { z } from 'zod';
import { subscriptions } from '../../../../trip';
import { requireTrip } from '../../../../utils/trip-access';

/**
 * Registers a device's subscription to Notifications in the Trip (#41), or replaces it
 * (`Subscriptions.register`). The device sends it again until it gets through. The `deviceId`
 * route param is the device's opaque id, the one its changes carry. An endpoint at no known
 * push service gets 400, and a new device in a Trip that is full 409, which the device keeps
 * sending, as it does any refusal.
 */
export default defineEventHandler(async (event): Promise<void> => {
  const trip = await requireTrip(event);
  const deviceId = z.uuid().safeParse(getRouterParam(event, 'deviceId'));
  if (!deviceId.success) throw createError({ status: 400, statusText: 'Invalid device id' });
  const request = await readValidatedBody(event, subscriptionRequestSchema);
  const registration = await subscriptions().register(trip.id, deviceId.data, request);
  if (registration === 'unknownPushService') {
    throw createError({ status: 400, statusText: 'Not a known push service' });
  }
  if (registration === 'tripFull') {
    throw createError({ status: 409, statusText: 'Too many subscriptions in the Trip' });
  }
  event.res.status = 204;
});
