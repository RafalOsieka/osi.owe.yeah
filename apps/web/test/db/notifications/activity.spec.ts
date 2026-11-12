import { randomBytes } from 'node:crypto';
import type {
  Expense,
  ExpenseChange,
  Participant,
  RevisionKind,
  SyncChange,
  TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it, onTestFinished, vi } from 'vitest';
import webpush from 'web-push';
import { notificationSubscriptions } from '../../../server/db/schema';
import { createNotifications } from '../../../server/notifications/activity';
import { createRates } from '../../../server/trip/rates';
import { createTripStore } from '../../../server/trip/store';
import { createTripSync, type Notifier, type TripSync } from '../../../server/trip/sync';
import { describeWithDocker } from '../../e2e/harness/postgres';
import { startPushService } from '../../e2e/harness/push-service';
import { useMigratedDatabase } from '../database';

const describeDb = describeWithDocker();

// The push services devices subscribe with.
const pushService = await startPushService();
afterAll(pushService.close);

// The device making every change in these tests; no subscribed device is it.
const deviceId = uuidv7();

function participant(name: string): Participant {
  return { id: uuidv7(), name };
}

function change(expense: Expense, claimId: string | null, baseVersion: number | null = null) {
  return {
    id: uuidv7(),
    claimId,
    deviceId,
    kind: 'expense',
    baseVersion,
    expense,
    deleted: false,
  } satisfies ExpenseChange;
}

/** A plain Expense of 24.50 EUR paid by `payer`, split evenly between `ticked`. */
function plainExpense(payer: Participant, ticked: Participant[], unitPrice = 2450): Expense {
  return {
    id: uuidv7(),
    title: 'Lidl Rovinj',
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: payer.id,
    lineItems: [
      {
        name: '',
        unitPrice,
        quantity: 1,
        split: { mode: 'even', participantIds: ticked.map(({ id }) => id) },
      },
    ],
  };
}

/** What a device is sent about one change, as the only one or the latest of `count`. */
function activity(
  trip: TripWithParticipants,
  expense: Expense,
  latest: { author: string | null; action: RevisionKind; paid: string; share: string },
  count = 1,
) {
  return {
    kind: 'activity',
    tripId: trip.id,
    tripName: trip.name,
    currency: trip.currency,
    count,
    latest: { expenseId: expense.id, title: expense.title, ...latest },
  };
}

describeDb('Notifications', () => {
  const db = useMigratedDatabase();
  // The Notifications under way, so a test can wait for them all to be sent.
  const sending: Promise<void>[] = [];
  const vapid = { ...webpush.generateVAPIDKeys(), subject: 'mailto:test@example.com' };
  let sync: TripSync;

  /**
   * The Trip sync with Notifications, sent to any endpoint, as the plain http stand-in needs,
   * or only to known push services, as in production.
   */
  function syncWith(anyEndpoint: boolean): TripSync {
    const store = createTripStore(db());
    const rates = createRates(db(), 'http://127.0.0.1:9');
    const notifications = createNotifications(db(), store, rates, { vapid, anyEndpoint });
    const notifier: Notifier = {
      notifyAffected(tripId, applied) {
        const sent = notifications.notifyAffected(tripId, applied);
        sending.push(sent);
        return sent;
      },
    };
    return createTripSync(db(), store, rates, notifier);
  }

  beforeAll(() => {
    sync = syncWith(true);
  });

  /** Pushes changes, then waits until every device they concern has been sent its Notification. */
  async function push(tripId: string, token: string, ...changes: SyncChange[]): Promise<void> {
    expect(await sync.push(tripId, token, { changes })).not.toBe('invalidLink');
    await Promise.all(sending.splice(0));
  }

  /** Subscribes `device` to the Trip's Notifications, for the Participant it claims. */
  async function subscribe(tripId: string, device: string, claimId: string): Promise<void> {
    const { endpoint, keys } = pushService.subscription(device);
    await db()
      .insert(notificationSubscriptions)
      .values({ tripId, deviceId: device, endpoint, ...keys, claimId });
  }

  /**
   * A Trip with Kasia, Ania and Ola, with a device subscribed for each of them, named after
   * the Participant it claims.
   */
  async function subscribedTrip() {
    const kasia = participant('Kasia');
    const ania = participant('Ania');
    const ola = participant('Ola');
    const trip: TripWithParticipants = {
      id: uuidv7(),
      name: 'Croatia 2026',
      currency: 'EUR',
      participants: [kasia, ania, ola],
    };
    const token = randomBytes(32).toString('base64url');
    await push(
      trip.id,
      token,
      { id: uuidv7(), claimId: null, deviceId, kind: 'trip', trip },
      ...trip.participants.map((added) => ({
        id: uuidv7(),
        claimId: null,
        deviceId,
        kind: 'participant' as const,
        participant: added,
        removed: false,
      })),
    );
    const devices = { kasia: uuidv7(), ania: uuidv7(), ola: uuidv7() };
    await subscribe(trip.id, devices.kasia, kasia.id);
    await subscribe(trip.id, devices.ania, ania.id);
    await subscribe(trip.id, devices.ola, ola.id);
    return { trip, token, kasia, ania, ola, devices };
  }

  it("tells the devices of the Participants a change affects what it did, but not the author's", async () => {
    const { trip, token, kasia, ania, devices } = await subscribedTrip();
    // 30.00 EUR paid by Kasia for herself and Ania; Ola is not in it.
    const lidl = plainExpense(kasia, [kasia, ania], 3000);

    await push(trip.id, token, change(lidl, kasia.id));

    const added = { author: 'Kasia', action: 'added', paid: '0.00', share: '15.00' };
    expect(pushService.payloadsOf(devices.ania)).toEqual([activity(trip, lidl, added)]);
    expect(pushService.payloadsOf(devices.ola)).toEqual([]);
    expect(pushService.payloadsOf(devices.kasia)).toEqual([]);

    // Ania deletes it: Kasia hears what she paid and her share are taken back.
    await push(trip.id, token, { ...change(lidl, ania.id, 1), deleted: true });

    const deleted = { author: 'Ania', action: 'deleted', paid: '-30.00', share: '-15.00' };
    expect(pushService.payloadsOf(devices.kasia)).toEqual([activity(trip, lidl, deleted)]);
    expect(pushService.payloadsOf(devices.ania)).toHaveLength(1);
  });

  it('says an Expense was edited, or restored once deleted', async () => {
    const { trip, token, kasia, ania, devices } = await subscribedTrip();
    const lidl = plainExpense(kasia, [kasia, ania], 3000);
    await push(trip.id, token, change(lidl, kasia.id));

    const dearer = { ...lidl, lineItems: [{ ...lidl.lineItems[0]!, unitPrice: 4000 }] };
    await push(trip.id, token, change(dearer, ania.id, 1));
    await push(trip.id, token, { ...change(dearer, ania.id, 2), deleted: true });
    await push(trip.id, token, change(dearer, ania.id, 3));

    expect(pushService.payloadsOf(devices.kasia)).toEqual([
      activity(trip, dearer, { author: 'Ania', action: 'edited', paid: '10.00', share: '5.00' }),
      activity(trip, dearer, {
        author: 'Ania',
        action: 'deleted',
        paid: '-40.00',
        share: '-20.00',
      }),
      activity(trip, dearer, { author: 'Ania', action: 'restored', paid: '40.00', share: '20.00' }),
    ]);
  });

  it('sends one Notification per device for a push, about the latest change in it', async () => {
    const { trip, token, kasia, ola, devices } = await subscribedTrip();
    const first = plainExpense(kasia, [ola]);
    const second = { ...plainExpense(kasia, [kasia, ola]), title: 'Konzum' };

    await push(trip.id, token, change(first, null), change(second, null));

    const latest = { author: null, action: 'added', paid: '0.00', share: '12.25' };
    expect(pushService.payloadsOf(devices.ola)).toEqual([activity(trip, second, latest, 2)]);
  });

  it("follows a device's Claim once it subscribes with another", async () => {
    const { trip, token, kasia, ania, devices } = await subscribedTrip();
    // Ania's device now says it is Kasia: Kasia's own changes are not news to it.
    await db()
      .update(notificationSubscriptions)
      .set({ claimId: kasia.id })
      .where(eq(notificationSubscriptions.deviceId, devices.ania));

    await push(trip.id, token, change(plainExpense(kasia, [kasia, ania]), kasia.id));
    const forKasia = plainExpense(ania, [kasia]);
    await push(trip.id, token, change(forKasia, ania.id));

    expect(pushService.payloadsOf(devices.ania)).toEqual([
      activity(trip, forKasia, { author: 'Ania', action: 'added', paid: '0.00', share: '24.50' }),
    ]);
  });

  it('sends at most 10 Notifications at a time, and all of them in the end', async () => {
    const { trip, token, kasia, ania, devices } = await subscribedTrip();
    const more = Array.from({ length: 24 }, () => uuidv7());
    for (const device of more) await subscribe(trip.id, device, ania.id);
    pushService.answerAfter(50);
    onTestFinished(() => pushService.answerAfter(0));
    pushService.mostAtOnce();

    await push(trip.id, token, change(plainExpense(kasia, [kasia, ania]), kasia.id));

    expect(pushService.mostAtOnce()).toBeLessThanOrEqual(10);
    for (const device of [devices.ania, ...more]) {
      expect(pushService.payloadsOf(device)).toHaveLength(1);
    }
  });

  it('prunes a subscription its push service says is gone', async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    pushService.gone(devices.ania);
    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), kasia.id));

    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), kasia.id));

    expect(pushService.payloadsOf(devices.ania)).toHaveLength(1);
    expect(pushService.payloadsOf(devices.ola)).toHaveLength(2);
  });

  it('warns about a stored subscription its keys cannot encrypt for, and prunes it', async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    // Stored before registration checked the keys' lengths.
    await db()
      .update(notificationSubscriptions)
      .set({ p256dh: 'p256dh', auth: 'auth' })
      .where(eq(notificationSubscriptions.deviceId, devices.ania));
    // Of the right length, but no point on the curve: registration takes it.
    const offCurve = uuidv7();
    await subscribe(trip.id, offCurve, ola.id);
    await db()
      .update(notificationSubscriptions)
      .set({ p256dh: Buffer.alloc(65).toString('base64url') })
      .where(eq(notificationSubscriptions.deviceId, offCurve));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());

    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), kasia.id));
    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), kasia.id));

    expect(warn).toHaveBeenCalledTimes(2);
    expect(pushService.payloadsOf(devices.ola)).toHaveLength(2);
    const left = await db()
      .select({ deviceId: notificationSubscriptions.deviceId })
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.tripId, trip.id));
    expect(left.map(({ deviceId }) => deviceId).toSorted()).toEqual(
      [devices.kasia, devices.ola].toSorted(),
    );
  });

  it('sends nothing to an endpoint off the known push services', async () => {
    sync = syncWith(false);
    onTestFinished(() => {
      sync = syncWith(true);
    });
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();

    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), kasia.id));

    expect(pushService.payloadsOf(devices.ania)).toEqual([]);
    expect(pushService.payloadsOf(devices.ola)).toEqual([]);
  });

  it("doesn't follow a push service's redirect, nor prune the subscription for it", async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    // Followed, the redirect would end at an endpoint that is gone, and prune Ania's.
    const elsewhere = uuidv7();
    pushService.gone(elsewhere);
    pushService.redirect(devices.ania, elsewhere);
    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), kasia.id));

    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), kasia.id));

    expect(pushService.payloadsOf(devices.ania)).toHaveLength(2);
  });
});
