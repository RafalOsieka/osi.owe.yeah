import type { PushMessage } from '@osi/owe-yeah-domain';
import { inArray } from 'drizzle-orm';
import { useRuntimeConfig } from 'nuxt/server';
import webpush from 'web-push';
import { getDb } from '../db';
import { notificationSubscriptions } from '../db/schema';

// How long a push service keeps a notification for a device that is offline. The next pull
// brings the change anyway.
const TTL_SECONDS = 24 * 60 * 60;

/** The server's VAPID keys and subject, which every notification is signed with. */
export type VapidDetails = webpush.VapidKeys & { subject: string };

/** The VAPID keys notifications are sent with; `null` when none are set, so nothing is sent. */
export function vapidDetails(): VapidDetails | null {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = useRuntimeConfig();
  if (!vapidPublicKey || !vapidPrivateKey) return null;
  return { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };
}

type NotificationSubscriptionRow = typeof notificationSubscriptions.$inferSelect;

/**
 * Sends each subscription the message `messageOf` writes for it (`null`: none), all at once,
 * then deletes those whose push service answers 404 or 410, as gone. Nothing is retried.
 * Never rejects.
 */
export async function deliver(
  subscriptions: readonly NotificationSubscriptionRow[],
  messageOf: (subscription: NotificationSubscriptionRow) => PushMessage | null,
  vapid: VapidDetails,
): Promise<void> {
  const gone = new Set<string>();
  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const message = messageOf(subscription);
      if (!message) return;
      const { endpoint, p256dh, auth } = subscription;
      const status = await send({ endpoint, keys: { p256dh, auth } }, message, vapid);
      if (status === 404 || status === 410) gone.add(endpoint);
    }),
  );
  if (gone.size === 0) return;
  try {
    await getDb()
      .delete(notificationSubscriptions)
      .where(inArray(notificationSubscriptions.endpoint, [...gone]));
  } catch (error) {
    console.warn('Gone notification subscriptions could not be pruned', error);
  }
}

/**
 * Sends one notification, encrypted for the subscription, and resolves to the push service's
 * status, or `null` when it can't be reached. `web-push` builds the request; it is sent with
 * `fetch` here, which also speaks the plain http of the api e2e suite's stand-in.
 */
async function send(
  subscription: webpush.PushSubscription,
  message: PushMessage,
  vapid: VapidDetails,
): Promise<number | null> {
  const request = webpush.generateRequestDetails(subscription, JSON.stringify(message), {
    vapidDetails: vapid,
    TTL: TTL_SECONDS,
  });
  // `fetch` works the length out itself and refuses to be told.
  const { 'Content-Length': _, ...headers } = request.headers;
  try {
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers,
      body: request.body && new Uint8Array(request.body),
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch (error) {
    console.warn('A notification could not be sent', error);
    return null;
  }
}
