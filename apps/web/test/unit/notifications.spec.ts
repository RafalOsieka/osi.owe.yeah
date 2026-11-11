import 'fake-indexeddb/auto';
import type { SubscriptionRequest } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { DeviceDb, NOTIFICATIONS_OFF } from '../../app/sync/db';
import { createNotifications } from '../../app/sync/notifications';

const kasia = { id: uuidv7(), name: 'Kasia' };
const ania = { id: uuidv7(), name: 'Ania' };

/** The browser's push subscription, as the device keeps it while notifications are on. */
const browserSubscription = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'p256dh', auth: 'auth' },
};

/**
 * The server's push subscriptions of one device, behind a network the test controls: while
 * `offline` nothing gets through. The server side of subscriptions is tested on its own.
 */
class Subscriptions {
  offline = false;
  /** The device's push subscription to each Trip, as the server has it. */
  readonly byTrip = new Map<string, SubscriptionRequest>();
  subscribeCalls = 0;

  private throwIfOffline(): void {
    if (this.offline) throw new Error('offline');
  }

  async subscribe(
    tripId: string,
    _token: string,
    _deviceId: string,
    request: SubscriptionRequest,
  ): Promise<void> {
    this.throwIfOffline();
    this.subscribeCalls++;
    this.byTrip.set(tripId, request);
  }

  async unsubscribe(tripId: string): Promise<void> {
    this.throwIfOffline();
    this.byTrip.delete(tripId);
  }
}

/**
 * A device store with a Trip on it that Kasia claimed, the server's subscriptions of the
 * device, and the device's Notification subscriptions over both.
 */
async function setUp() {
  const db = new DeviceDb(uuidv7());
  const server = new Subscriptions();
  const tripId = uuidv7();
  await db.trips.add({
    id: tripId,
    token: 'x'.repeat(43),
    claim: kasia,
    openedAt: new Date().toISOString(),
    snapshot: null,
    rates: [],
    lastCurrency: null,
    notices: [],
    notifications: NOTIFICATIONS_OFF,
  });
  return { db, server, tripId, notifications: createNotifications(db, server, uuidv7()) };
}

describe("the device's Notification subscriptions", () => {
  it('registers its push subscription once per Claim while notifications are on', async () => {
    const { db, server, tripId, notifications } = await setUp();
    await notifications.set(tripId, { subscription: browserSubscription, offered: true });

    await notifications.reconcile(tripId);
    expect(server.byTrip.get(tripId)).toEqual({ ...browserSubscription, claimId: kasia.id });

    await db.trips.update(tripId, { claim: ania });
    await notifications.reconcile(tripId);
    await notifications.reconcile(tripId);
    expect(server.byTrip.get(tripId)).toEqual({ ...browserSubscription, claimId: ania.id });
    // Sent once per Claim: an unchanged subscription is not sent again.
    expect(server.subscribeCalls).toBe(2);
  });

  it('removes its push subscription once notifications are off, after being offline', async () => {
    const { server, tripId, notifications } = await setUp();
    await notifications.set(tripId, { subscription: browserSubscription, offered: true });
    await notifications.reconcile(tripId);

    server.offline = true;
    await notifications.set(tripId, { subscription: null });
    await expect(notifications.reconcile(tripId)).rejects.toThrow('offline');
    expect(server.byTrip.has(tripId)).toBe(true);

    server.offline = false;
    await notifications.reconcile(tripId);
    expect(server.byTrip.has(tripId)).toBe(false);
  });
});
