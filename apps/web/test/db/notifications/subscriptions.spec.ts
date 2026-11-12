import { randomBytes } from 'node:crypto';
import type { SubscriptionRequest } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { expect, it, onTestFinished, vi } from 'vitest';
import { trips } from '../../../server/db/schema';
import { createSubscriptions } from '../../../server/notifications/subscriptions';
import { hashTripToken } from '../../../server/utils/trip-token';
import { describeWithDocker } from '../../e2e/harness/postgres';
import { useMigratedDatabase } from '../database';

const describeDb = describeWithDocker();

/** `device`'s push subscription at Chrome's push service, for the Participant it claims. */
function registration(device: string, claimId: string): SubscriptionRequest {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
    keys: {
      p256dh: randomBytes(65).toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
    claimId,
  };
}

describeDb('Notification subscriptions', () => {
  const db = useMigratedDatabase();

  /** A stored Trip's id. */
  async function storedTrip(): Promise<string> {
    const id = uuidv7();
    const tokenHash = hashTripToken(randomBytes(32).toString('base64url'));
    await db().insert(trips).values({ id, name: 'Croatia 2026', currency: 'EUR', tokenHash });
    return id;
  }

  it('takes at most 200 in a Trip, from devices registering at once too, and still replaces one it has', async () => {
    const subscriptions = createSubscriptions(db(), { anyEndpoint: false });
    const tripId = await storedTrip();
    const [kasia, ania] = [uuidv7(), uuidv7()];
    const devices = Array.from({ length: 201 }, () => uuidv7());

    const registered = await Promise.all(
      devices.map((device) => subscriptions.register(tripId, device, registration(device, kasia))),
    );

    expect(registered.filter((answer) => answer === 'registered')).toHaveLength(200);
    expect(registered.filter((answer) => answer === 'tripFull')).toHaveLength(1);
    // A device it has now says it is Ania.
    const device = devices.find((_, index) => registered[index] === 'registered') ?? '';
    expect(await subscriptions.register(tripId, device, registration(device, ania))).toBe(
      'registered',
    );
    expect(await subscriptions.ofParticipant(tripId, ania)).toHaveLength(1);
    expect(await subscriptions.ofTrip(tripId)).toHaveLength(200);
  });

  it("replaces a device's subscription when it registers with another Claim, and forgets it once removed", async () => {
    const subscriptions = createSubscriptions(db(), { anyEndpoint: false });
    const tripId = await storedTrip();
    const [kasia, ania] = [uuidv7(), uuidv7()];
    const [kasias, anias] = [uuidv7(), uuidv7()];
    await subscriptions.register(tripId, kasias, registration(kasias, kasia));
    await subscriptions.register(tripId, anias, registration(anias, ania));

    // Ania's device now says it is Kasia.
    const renewed = registration(anias, kasia);
    await subscriptions.register(tripId, anias, renewed);

    expect(await subscriptions.reachable(tripId)).toEqual([kasia]);
    expect(await subscriptions.ofParticipant(tripId, kasia)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: anias, endpoint: renewed.endpoint, ...renewed.keys }),
      ]),
    );
    expect(await subscriptions.ofParticipant(tripId, ania)).toEqual([]);

    await subscriptions.remove(tripId, anias);

    const left = await subscriptions.ofParticipant(tripId, kasia);
    expect(left.map(({ deviceId }) => deviceId)).toEqual([kasias]);
  });

  it('takes an endpoint only at a known push service, unless it takes any', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const tripId = await storedTrip();
    const device = uuidv7();
    const elsewhere = { ...registration(device, uuidv7()), endpoint: 'https://example.com/push' };

    const onlyKnown = createSubscriptions(db(), { anyEndpoint: false });
    expect(await onlyKnown.register(tripId, device, elsewhere)).toBe('unknownPushService');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('example.com'));
    expect(await onlyKnown.ofTrip(tripId)).toEqual([]);

    const any = createSubscriptions(db(), { anyEndpoint: true });
    expect(await any.register(tripId, device, elsewhere)).toBe('registered');
  });
});
