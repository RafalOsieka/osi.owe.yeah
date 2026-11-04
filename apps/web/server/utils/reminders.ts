import {
  balances,
  roundMoney,
  suggestedRepayments,
  type ReminderMessage,
  type ReminderRefusal,
  type ReminderRequest,
  type ReminderStatus,
} from '@osi/owe-yeah-domain';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { notificationSubscriptions, reminders } from '../db/schema';
import { deliver, vapidDetails } from '../notifications/delivery';
import type { Rates } from '../trip/rates';
import type { TripStore, WholeTrip } from '../trip/store';

// A pair is reminded at most once per calendar day, in UTC: the Trip has no time zone of its own.
const startOfToday = sql`date_trunc('day', now(), 'UTC')`;

/** Reminders (#42), reading the Trip through `store` and converting at `rates`. */
export function createReminders(db: Database, store: TripStore, rates: Rates) {
  /**
   * The Repayment `to` owes `from` as the server's balances suggest it now (`suggestedRepayments`),
   * or `undefined` when they suggest none between them.
   */
  async function currentSuggestion(trip: WholeTrip, { from, to }: ReminderRequest) {
    const everyone = balances({
      currency: trip.currency,
      participants: trip.participants,
      expenses: trip.expenses.filter(({ deleted }) => !deleted),
      rates: await rates.forTrip(trip),
    });
    return suggestedRepayments(everyone).find(
      ({ payerId, recipientId }) => payerId === to && recipientId === from,
    );
  }

  return {
    /**
     * Sends a Reminder: `from` reminds `to` of the Repayment `to` owes them, on every device
     * claiming `to`. Resolves to its refusal instead (`ReminderRefusal`) unless the server's
     * balances suggest exactly that Repayment now (`notSuggested`); when no device of `to`'s can
     * be notified, as the creditor then shares a message instead (`unreachable`); and when the
     * pair was reminded today already (`remindedToday`). Only a Reminder sent moves the pair's
     * row on. Sent fire-and-forget once it is allowed.
     */
    async send(
      tripId: string,
      { from, to }: ReminderRequest,
    ): Promise<ReminderRefusal | undefined> {
      const trip = await store.readTrip(tripId);
      const suggestion = trip && (await currentSuggestion(trip, { from, to }));
      // Always found with a suggestion: its creditor has a balance in the Trip.
      const creditor = trip?.participants.find(({ id }) => id === from);
      if (!trip || !suggestion || !creditor) return { refused: 'notSuggested' };

      const vapid = vapidDetails();
      const devices = vapid
        ? await db
            .select()
            .from(notificationSubscriptions)
            .where(
              and(
                eq(notificationSubscriptions.tripId, trip.id),
                eq(notificationSubscriptions.claimId, to),
              ),
            )
        : [];
      if (!vapid || devices.length === 0) return { refused: 'unreachable' };

      // One statement, so two Reminders sent at once can't both get through.
      const [sent] = await db
        .insert(reminders)
        .values({ tripId: trip.id, fromId: from, toId: to })
        .onConflictDoUpdate({
          target: [reminders.tripId, reminders.fromId, reminders.toId],
          set: { sentAt: sql`now()` },
          setWhere: sql`${reminders.sentAt} < ${startOfToday}`,
        })
        .returning({ sentAt: reminders.sentAt });
      if (!sent) return { refused: 'remindedToday' };

      const message: ReminderMessage = {
        kind: 'reminder',
        tripId: trip.id,
        tripName: trip.name,
        currency: trip.currency,
        from: { id: from, name: creditor.name },
        to,
        amount: roundMoney(suggestion.amount, trip.currency).decimal,
      };
      void deliver(db, devices, () => message, vapid);
      return undefined;
    },

    /**
     * Whom a Reminder can reach in the Trip, and the pairs reminded today (`ReminderStatus`).
     * Nobody is reachable while the server has no VAPID keys.
     */
    async status(tripId: string): Promise<ReminderStatus> {
      const [subscribed, today] = await Promise.all([
        vapidDetails()
          ? db
              .selectDistinct({ claimId: notificationSubscriptions.claimId })
              .from(notificationSubscriptions)
              .where(eq(notificationSubscriptions.tripId, tripId))
          : [],
        db
          .select({ from: reminders.fromId, to: reminders.toId })
          .from(reminders)
          .where(and(eq(reminders.tripId, tripId), gte(reminders.sentAt, startOfToday))),
      ]);
      return { reachable: subscribed.map(({ claimId }) => claimId), remindedToday: today };
    },
  };
}
