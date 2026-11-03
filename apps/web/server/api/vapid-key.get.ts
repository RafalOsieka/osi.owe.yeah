import type { PushKeyResponse } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, useRuntimeConfig } from 'nuxt/server';

/**
 * The server's VAPID public key, which a device subscribes to Notifications with (#41). Asked
 * for at runtime, as the prerendered app can't carry it. 404 while Notifications aren't
 * configured.
 */
export default defineEventHandler((): PushKeyResponse => {
  const { vapidPublicKey, vapidPrivateKey } = useRuntimeConfig();
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw createError({ status: 404, statusText: 'Notifications are not configured' });
  }
  return { publicKey: vapidPublicKey };
});
