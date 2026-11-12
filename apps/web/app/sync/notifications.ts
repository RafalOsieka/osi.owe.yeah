import type {
  BrowserSubscription,
  DeviceDb,
  DeviceNotifications,
  DeviceTrip,
  ForgottenTrip,
} from './db';
import type { Transport } from './device';

/**
 * The device's Notification subscriptions (#41): what each Trip wants on this device against
 * what the server has, kept in the same device store as the Trips. Internal to the device:
 * sync reconciles a Trip at the end of each run, as a Trip created offline exists on the
 * server only after its push, and forgetting a Trip keeps its subscription for removal.
 */
export function createNotifications(
  db: DeviceDb,
  transport: Pick<Transport, 'subscribe' | 'unsubscribe'>,
  deviceId: string,
) {
  // The Trips whose push subscription the server took during this run of the app.
  const subscribedThisRun = new Set<string>();

  /** Changes a Trip's notifications on this device: turned on or off, declined, registered. */
  async function set(tripId: string, change: Partial<DeviceNotifications>): Promise<void> {
    await db.transaction('rw', db.trips, async () => {
      const device = await db.trips.get(tripId);
      if (!device) return;
      await db.trips.update(tripId, { notifications: { ...device.notifications, ...change } });
    });
  }

  /**
   * Takes the browser's push subscription as it is now, e.g. renewed by the browser, for every
   * Trip with notifications on. Resolves to the Trips it changed, which need a sync.
   */
  async function renew(subscription: BrowserSubscription): Promise<string[]> {
    return db.transaction('rw', db.trips, async () => {
      const ids: string[] = [];
      for (const device of await db.trips.toArray()) {
        const kept = device.notifications.subscription;
        if (!kept || kept.endpoint === subscription.endpoint) continue;
        await db.trips.update(device.id, {
          notifications: { ...device.notifications, subscription },
        });
        ids.push(device.id);
      }
      return ids;
    });
  }

  /**
   * Gives the server the push subscription the Trip should have on this device, if it has
   * not got it: the browser's, for the device's Claim, while notifications are on and the
   * device has a Claim; otherwise none. Sent again once per run of the app, as the server
   * drops a subscription whose push service says it is gone. A subscription left from when the
   * Trip was forgotten goes first, so it can't remove the new one later. Rejects when the
   * server can't be reached; the next sync tries again.
   */
  async function reconcile(tripId: string): Promise<void> {
    const left = await db.forgotten.get(tripId);
    if (left) await removeForgotten(left);
    const device = await db.trips.get(tripId);
    if (!device) return;
    const { subscription, registered } = device.notifications;
    const claimId = device.claim?.id;
    const wanted = subscription && claimId ? { endpoint: subscription.endpoint, claimId } : null;
    const same =
      wanted?.endpoint === registered?.endpoint && wanted?.claimId === registered?.claimId;
    if (same && (!wanted || subscribedThisRun.has(tripId))) return;
    if (subscription && wanted) {
      await transport.subscribe(tripId, device.token, deviceId, { ...subscription, ...wanted });
      subscribedThisRun.add(tripId);
    } else {
      await transport.unsubscribe(tripId, device.token, deviceId);
    }
    // What the server has now: a change made meanwhile is sent on the next sync.
    await set(tripId, { registered: wanted });
  }

  /**
   * Keeps the token of a Trip being forgotten while the server may have its push subscription,
   * so `removeAllForgotten` can remove it later. Called in the transaction that forgets the
   * Trip, which must include `db.forgotten`.
   */
  async function forget(device: DeviceTrip): Promise<void> {
    const { subscription, registered } = device.notifications;
    if (subscription || registered) {
      await db.forgotten.put({ tripId: device.id, token: device.token });
    }
  }

  async function removeForgotten({ tripId, token }: ForgottenTrip): Promise<void> {
    await transport.unsubscribe(tripId, token, deviceId);
    await db.forgotten.delete(tripId);
  }

  /**
   * Removes the push subscriptions of Trips forgotten on this device that the server may
   * still have. Never rejects: whatever doesn't get through waits for the next time.
   */
  async function removeAllForgotten(): Promise<void> {
    for (const forgotten of await db.forgotten.toArray()) {
      await removeForgotten(forgotten).catch(() => {});
    }
  }

  return { set, renew, reconcile, forget, removeAllForgotten };
}
