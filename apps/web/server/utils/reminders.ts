import {
  balances,
  roundMoney,
  suggestedRepayments,
  type Participant,
  type ReminderMessage,
  type ReminderRequest,
  type ReminderStatus,
  type Trip,
} from '@osi/owe-yeah-domain';
import { and, eq, gte, not, sql } from 'drizzle-orm';
import { createError } from 'nuxt/server';
import { getDb } from '../db';
import { expenses, notificationSubscriptions, reminders } from '../db/schema';
import { deliver, vapidDetails } from '../notifications/delivery';
import { loadTripRates } from './rates';
import { loadParticipants } from './trip-snapshot';

// A pair is reminded at most once per calendar day, in UTC: the Trip has no time zone of its own.
const startOfToday = sql`date_trunc('day', now(), 'UTC')`;

/**
 * Sends a Reminder (#42): `from` reminds `to` of the Repayment `to` owes them, on every device
 * claiming `to`. Refused with 403 unless the server's balances suggest exactly that Repayment
 * now; with 409 when no device of `to`'s can be notified, as the creditor then shares a
 * message instead; and with 429 when the pair was reminded today already. Only a Reminder
 * sent moves the pair's row on. Sent fire-and-forget once it is allowed.
 */
export async function sendReminder(trip: Trip, { from, to }: ReminderRequest): Promise<void> {
  const participants = await loadParticipants(trip.id);
  const suggestion = await currentSuggestion(trip, participants, { from, to });
  // Always found with a suggestion: its creditor has a balance in the Trip.
  const creditor = participants.find(({ id }) => id === from);
  if (!suggestion || !creditor) {
    throw createError({ status: 403, statusText: 'Only the creditor of a suggestion reminds' });
  }

  const vapid = vapidDetails();
  const db = getDb();
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
  if (!vapid || devices.length === 0) {
    throw createError({ status: 409, statusText: 'The debtor cannot be notified' });
  }

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
  if (!sent) throw createError({ status: 429, statusText: 'Reminded today' });

  const message: ReminderMessage = {
    kind: 'reminder',
    tripId: trip.id,
    tripName: trip.name,
    currency: trip.currency,
    from: { id: from, name: creditor.name },
    to,
    amount: roundMoney(suggestion.amount, trip.currency).decimal,
  };
  void deliver(devices, () => message, vapid);
}

/**
 * The Repayment `to` owes `from` as the server's balances suggest it now (`suggestedRepayments`),
 * or `undefined` when they suggest none between them.
 */
async function currentSuggestion(
  trip: Trip,
  participants: Participant[],
  { from, to }: ReminderRequest,
) {
  const rows = await getDb()
    .select({ id: expenses.id, state: expenses.state })
    .from(expenses)
    .where(and(eq(expenses.tripId, trip.id), not(expenses.deleted)));
  const everyone = balances({
    currency: trip.currency,
    participants,
    expenses: rows.map(({ id, state }) => ({ ...state, id })),
    rates: await loadTripRates(trip),
  });
  return suggestedRepayments(everyone).find(
    ({ payerId, recipientId }) => payerId === to && recipientId === from,
  );
}

/**
 * Whom a Reminder can reach in the Trip, and the pairs reminded today (`ReminderStatus`).
 * Nobody is reachable while the server has no VAPID keys.
 */
export async function reminderStatus(tripId: string): Promise<ReminderStatus> {
  const db = getDb();
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
}
