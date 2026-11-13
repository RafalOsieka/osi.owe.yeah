import { ECDH } from 'node:crypto';
import { pushKeysSchema, type PushKeys, type PushMessage } from '@osi/owe-yeah-domain';
import { generateRequestDetails, type PushSubscription, type VapidKeys } from 'web-push';
import type { NotificationSubscription, Subscriptions } from './subscriptions';

// How long a push service keeps a notification for a device that is offline. The next pull
// brings the change anyway.
const TTL_SECONDS = 24 * 60 * 60;

// How many notifications are on their way at once, however many subscriptions a Trip has.
const SENDING_AT_ONCE = 10;

/** The server's VAPID keys and subject, which every notification is signed with. */
export type VapidDetails = VapidKeys & { subject: string };

/**
 * Sends each of `to` the message `messageOf` writes for it (`null`: none), signed with
 * `vapid`, at most `SENDING_AT_ONCE` at a time, then prunes from `subscriptions` those whose
 * push service answers 404 or 410, as gone, and those whose keys can't encrypt a message
 * (`encryptionKeys`), with a warning each. One at an endpoint the server doesn't send to
 * (`Subscriptions.sendsTo`) gets nothing. Nothing is retried. Never rejects.
 */
export async function deliver(
  subscriptions: Subscriptions,
  to: readonly NotificationSubscription[],
  messageOf: (subscription: NotificationSubscription) => PushMessage | null,
  vapid: VapidDetails,
): Promise<void> {
  const gone = new Set<string>();
  const unencryptable: NotificationSubscription[] = [];
  await eachAtMost(SENDING_AT_ONCE, to, async (subscription) => {
    const { endpoint, p256dh, auth } = subscription;
    if (!subscriptions.sendsTo(endpoint)) return;
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
  try {
    await subscriptions.prune({ gone: [...gone], unencryptable });
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
  subscription: PushSubscription,
  message: PushMessage,
  vapid: VapidDetails,
): Promise<number | null> {
  try {
    const request = generateRequestDetails(subscription, JSON.stringify(message), {
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
