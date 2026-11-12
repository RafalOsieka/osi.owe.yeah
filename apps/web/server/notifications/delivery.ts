import { ECDH } from 'node:crypto';
import { pushKeysSchema, type PushKeys, type PushMessage } from '@osi/owe-yeah-domain';
import { and, eq, inArray, or } from 'drizzle-orm';
import webpush from 'web-push';
import type { Database } from '../db/client';
import { notificationSubscriptions } from '../db/schema';
import { isKnownPushService } from './push-services';

// How long a push service keeps a notification for a device that is offline. The next pull
// brings the change anyway.
const TTL_SECONDS = 24 * 60 * 60;

// How many notifications are on their way at once, however many subscriptions a Trip has.
const SENDING_AT_ONCE = 10;

/** The server's VAPID keys and subject, which every notification is signed with. */
export type VapidDetails = webpush.VapidKeys & { subject: string };

/**
 * What Notifications and Reminders are sent with: the server's VAPID keys, and whether they go
 * to any endpoint (`notificationsAnyEndpoint`, in tests only) or to known push services only.
 */
export type PushSettings = { vapid: VapidDetails; anyEndpoint: boolean };

type NotificationSubscriptionRow = typeof notificationSubscriptions.$inferSelect;

/**
 * Sends each subscription the message `messageOf` writes for it (`null`: none), at most
 * `SENDING_AT_ONCE` at a time, then deletes from `db` those whose push service answers 404 or
 * 410, as gone, and those whose keys can't encrypt a message (`encryptionKeys`), with a
 * warning each. A subscription off the known push services gets nothing (unless
 * `anyEndpoint`), so rows stored before the subscription handler checked endpoints are never
 * sent to. Nothing is retried. Never rejects.
 */
export async function deliver(
  db: Database,
  subscriptions: readonly NotificationSubscriptionRow[],
  messageOf: (subscription: NotificationSubscriptionRow) => PushMessage | null,
  { vapid, anyEndpoint }: PushSettings,
): Promise<void> {
  const gone = new Set<string>();
  const unencryptable: NotificationSubscriptionRow[] = [];
  await eachAtMost(SENDING_AT_ONCE, subscriptions, async (subscription) => {
    const { endpoint, p256dh, auth } = subscription;
    if (!anyEndpoint && !isKnownPushService(endpoint)) return;
    const message = messageOf(subscription);
    if (!message) return;
    const keys = encryptionKeys({ p256dh, auth });
    if (!keys) {
      console.warn("A notification subscription whose keys can't encrypt is removed");
      unencryptable.push(subscription);
      return;
    }
    const status = await send({ endpoint, keys }, message, vapid);
    if (status === 404 || status === 410) gone.add(endpoint);
  });
  const pruned = [
    ...(gone.size > 0 ? [inArray(notificationSubscriptions.endpoint, [...gone])] : []),
    // The row as it was read, so a device that registers valid keys meanwhile keeps them.
    ...unencryptable.map(({ tripId, deviceId, p256dh, auth }) =>
      and(
        eq(notificationSubscriptions.tripId, tripId),
        eq(notificationSubscriptions.deviceId, deviceId),
        eq(notificationSubscriptions.p256dh, p256dh),
        eq(notificationSubscriptions.auth, auth),
      ),
    ),
  ];
  if (pruned.length === 0) return;
  try {
    await db.delete(notificationSubscriptions).where(or(...pruned));
  } catch (error) {
    console.warn('Notification subscriptions could not be pruned', error);
  }
}

/**
 * The keys a message can be encrypted with, or `null` when they can't encrypt: keys
 * registration refuses, or a public key of the right length that is no point on the P-256 curve,
 * which only a hand-written registration sends.
 */
function encryptionKeys(keys: PushKeys): PushKeys | null {
  if (!pushKeysSchema.safeParse(keys).success) return null;
  try {
    ECDH.convertKey(keys.p256dh, 'prime256v1', 'base64url');
    return keys;
  } catch {
    return null;
  }
}

/**
 * Runs `task` for every item, at most `limit` at a time, as workers that share one iterator.
 * A task that rejects is skipped; never rejects itself.
 */
async function eachAtMost<T>(
  limit: number,
  items: readonly T[],
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.values();
  const worker = async () => {
    for (const item of queue) await task(item).catch(() => {});
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Sends one notification, encrypted for the subscription, and resolves to the push service's
 * status, or `null` when it can't be built or the push service can't be reached. `web-push`
 * builds the request; it is sent with `fetch` here, which also speaks the plain http of the api
 * e2e suite's stand-in. A redirect isn't followed, so it can't lead anywhere off the push
 * service: it counts as unreachable.
 */
async function send(
  subscription: webpush.PushSubscription,
  message: PushMessage,
  vapid: VapidDetails,
): Promise<number | null> {
  try {
    const request = webpush.generateRequestDetails(subscription, JSON.stringify(message), {
      vapidDetails: vapid,
      TTL: TTL_SECONDS,
    });
    // `fetch` works the length out itself and refuses to be told.
    const { 'Content-Length': _, ...headers } = request.headers;
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers,
      body: request.body && new Uint8Array(request.body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch (error) {
    console.warn('A notification could not be sent', error);
    return null;
  }
}
