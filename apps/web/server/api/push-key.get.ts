import type { PushKeyResponse } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, useRuntimeConfig } from 'nuxt/server';

/**
 * The server's VAPID public key, which a device subscribes to push with (#41). Asked for at
 * runtime, as the prerendered app can't carry it. 404 while push isn't configured.
 */
export default defineEventHandler((): PushKeyResponse => {
  const { vapidPublicKey, vapidPrivateKey } = useRuntimeConfig();
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw createError({ status: 404, statusText: 'Push notifications are not configured' });
  }
  return { publicKey: vapidPublicKey };
});
