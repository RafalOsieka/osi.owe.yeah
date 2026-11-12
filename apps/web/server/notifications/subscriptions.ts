import type { SubscriptionRequest } from '@osi/owe-yeah-domain';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { notificationSubscriptions, trips } from '../db/schema';
import { isKnownPushService } from './push-services';

// How many devices' subscriptions a Trip keeps at most, so a Notification reaches a bounded
// number of push services.
const SUBSCRIPTION_LIMIT = 200;

/** A device's subscription to Notifications in one Trip, as the server keeps it. */
export type NotificationSubscription = typeof notificationSubscriptions.$inferSelect;

/**
 * How a registration went: `registered`, refused as `unknownPushService` (its endpoint is no
 * known push service) or as `tripFull` (the Trip has `SUBSCRIPTION_LIMIT` other devices').
 */
export type Registration = 'registered' | 'unknownPushService' | 'tripFull';

/**
 * Notification subscriptions (#41), kept in `db`: the only reader and writer of their table.
 * Unless `anyEndpoint` (in tests only), the server takes and sends to known push services
 * only (`isKnownPushService`).
 */
export function createSubscriptions(db: Database, { anyEndpoint }: { anyEndpoint: boolean }) {
  const sendsTo = (endpoint: string) => anyEndpoint || isKnownPushService(endpoint);

  return {
    /**
     * Whether the server sends to `endpoint`: subscriptions stored before registration
     * checked endpoints may be at one it doesn't.
     */
    sendsTo,

    /**
     * Registers a device's subscription to the Trip's Notifications with the Claim it has
     * now, replacing the one it had, so it follows a changed Claim. A refused endpoint logs
     * its host, so a push service missing from the list shows up. The Trip is locked while
     * its other devices' subscriptions are counted, so devices registering at once can't
     * pass the limit together.
     */
    async register(
      tripId: string,
      deviceId: string,
      { endpoint, keys, claimId }: SubscriptionRequest,
    ): Promise<Registration> {
      if (!sendsTo(endpoint)) {
        console.warn(`A push endpoint at an unknown host was refused: ${new URL(endpoint).host}`);
        return 'unknownPushService';
      }
      const subscription = { endpoint, p256dh: keys.p256dh, auth: keys.auth, claimId };
      return db.transaction(async (tx) => {
        await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for('update');
        const others = await tx.$count(
          notificationSubscriptions,
          and(
            eq(notificationSubscriptions.tripId, tripId),
            ne(notificationSubscriptions.deviceId, deviceId),
          ),
        );
        if (others >= SUBSCRIPTION_LIMIT) return 'tripFull';
        await tx
          .insert(notificationSubscriptions)
          .values({ tripId, deviceId, ...subscription })
          .onConflictDoUpdate({
            target: [notificationSubscriptions.tripId, notificationSubscriptions.deviceId],
            set: subscription,
          });
        return 'registered';
      });
    },

    /** Removes a device's subscription to the Trip's Notifications, if it has one. */
    async remove(tripId: string, deviceId: string): Promise<void> {
      await db
        .delete(notificationSubscriptions)
        .where(
          and(
            eq(notificationSubscriptions.tripId, tripId),
            eq(notificationSubscriptions.deviceId, deviceId),
          ),
        );
    },

    /** The Trip's subscriptions. */
    async ofTrip(tripId: string): Promise<NotificationSubscription[]> {
      return db
        .select()
        .from(notificationSubscriptions)
        .where(eq(notificationSubscriptions.tripId, tripId));
    },

    /** The Trip's subscriptions whose Claim is `participantId`. */
    async ofParticipant(
      tripId: string,
      participantId: string,
    ): Promise<NotificationSubscription[]> {
      return db
        .select()
        .from(notificationSubscriptions)
        .where(
          and(
            eq(notificationSubscriptions.tripId, tripId),
            eq(notificationSubscriptions.claimId, participantId),
          ),
        );
    },

    /** The Participants of the Trip some subscription claims, each once. */
    async reachable(tripId: string): Promise<string[]> {
      const claims = await db
        .selectDistinct({ claimId: notificationSubscriptions.claimId })
        .from(notificationSubscriptions)
        .where(eq(notificationSubscriptions.tripId, tripId));
      return claims.map(({ claimId }) => claimId);
    },

    /**
     * Deletes the subscriptions at the `gone` endpoints, in every Trip, and the `unencryptable`
     * ones as they were read, so a device that registers valid keys meanwhile keeps them.
     */
    async prune({
      gone,
      unencryptable,
    }: {
      gone: readonly string[];
      unencryptable: readonly NotificationSubscription[];
    }): Promise<void> {
      const pruned = [
        ...(gone.length > 0 ? [inArray(notificationSubscriptions.endpoint, [...gone])] : []),
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
      await db.delete(notificationSubscriptions).where(or(...pruned));
    },
  };
}

/** The server's Notification subscriptions (`createSubscriptions`). */
export type Subscriptions = ReturnType<typeof createSubscriptions>;
