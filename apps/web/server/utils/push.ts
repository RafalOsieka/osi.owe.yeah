import {
  balanceChanges,
  roundMoney,
  tripSchema,
  type BalanceChange,
  type Expense,
  type ExpenseChange,
  type PushMessage,
  type Trip,
} from '@osi/owe-yeah-domain';
import { and, eq, inArray, or } from 'drizzle-orm';
import { createError, getRouterParam, useRuntimeConfig, type RequestEvent } from 'nuxt/server';
import webpush from 'web-push';
import { z } from 'zod';
import { getDb } from '../db';
import { pushSubscriptions, revisions, trips } from '../db/schema';
import { loadRates } from './rates';
import { loadParticipants } from './trip-snapshot';

/** An Expense change the push has just applied (not a retry), with the version it made. */
export type AppliedExpenseChange = { change: ExpenseChange; version: number };

/** The `deviceId` route param: the device's opaque id, the one its changes carry. */
export function requireDeviceId(event: RequestEvent): string {
  const deviceId = z.uuid().safeParse(getRouterParam(event, 'deviceId'));
  if (!deviceId.success) throw createError({ status: 400, statusText: 'Invalid device id' });
  return deviceId.data;
}

// How long a push service keeps a notification for a device that is offline. The next pull
// brings the change anyway.
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Tells the devices subscribed to a Trip about the Expense changes a push has just applied,
 * fire-and-forget once the push has answered (#41). A device hears about a change that
 * affects the Participant it claims (`balanceChanges`), made under another Claim on another
 * device: one notification for the whole push, about the latest of them and how many there
 * were. Conflicts and refused changes never get here, and nothing is said about a Trip
 * becoming Settled. Subscriptions whose push service answers 404 or 410 are deleted. Nothing
 * is retried: a lost notification is fine, as the next pull brings the change. Never
 * rejects.
 */
export async function notifyAffected(
  tripId: string,
  applied: readonly AppliedExpenseChange[],
): Promise<void> {
  try {
    await notify(tripId, applied);
  } catch (error) {
    console.warn('Push notifications could not be worked out', error);
  }
}

async function notify(tripId: string, applied: readonly AppliedExpenseChange[]): Promise<void> {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = useRuntimeConfig();
  if (applied.length === 0 || !vapidPublicKey || !vapidPrivateKey) return;
  const db = getDb();
  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.tripId, tripId));
  if (subscriptions.length === 0) return;

  const [row] = await db
    .select({ id: trips.id, name: trips.name, currency: trips.currency })
    .from(trips)
    .where(eq(trips.id, tripId));
  // Narrows the stored currency to a Trip currency.
  const trip = tripSchema.parse(row);
  const activities = await activitiesOf(trip, applied);

  const vapidDetails = {
    subject: vapidSubject,
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey,
  };
  const gone = new Set<string>();
  await Promise.allSettled(
    subscriptions.map(async ({ deviceId, claimId, endpoint, p256dh, auth }) => {
      const message = messageFor(trip, activities, { deviceId, claimId });
      if (!message) return;
      const status = await send({ endpoint, keys: { p256dh, auth } }, message, vapidDetails);
      if (status === 404 || status === 410) gone.add(endpoint);
    }),
  );
  if (gone.size > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, [...gone]));
  }
}

/** One applied change as notifications tell it: what it did, who made it, whom it moved. */
type Activity = {
  change: ExpenseChange;
  action: PushMessage['latest']['action'];
  author: string | null;
  affected: ReadonlyMap<string, BalanceChange>;
};

/**
 * Each applied change with whom it affects (`balanceChanges`), from the Expense as its
 * Revision before showed it and as the change left it, converted at the Trip's rates.
 */
async function activitiesOf(
  trip: Trip,
  applied: readonly AppliedExpenseChange[],
): Promise<Activity[]> {
  const participants = await loadParticipants(trip.id);
  const names = new Map(participants.map(({ id, name }) => [id, name]));
  const before = await expensesBefore(applied);
  const changed = applied.map(({ change, version }) => ({
    change,
    version,
    was: before.get(change.id) ?? null,
    now: change.deleted ? null : change.expense,
  }));
  const rates = await loadRates(
    changed.flatMap(({ was, now }) => [was, now]).filter((expense) => expense !== null),
    trip.currency,
  );
  return changed.map(({ change, version, was, now }) => ({
    change,
    action: actionOf(change, version, was),
    author: change.claimId ? (names.get(change.claimId) ?? null) : null,
    affected: new Map(
      balanceChanges({ currency: trip.currency, participants, rates }, was, now).map((moved) => [
        moved.participantId,
        moved,
      ]),
    ),
  }));
}

/**
 * What one subscribed device is told: the changes that affect the Participant it claims,
 * made under another Claim on another device, as one message about the latest of them;
 * `null` when there are none.
 */
function messageFor(
  trip: Trip,
  activities: readonly Activity[],
  device: { deviceId: string; claimId: string },
): PushMessage | null {
  const news = activities.flatMap(({ change, action, author, affected }) => {
    const moved = affected.get(device.claimId);
    const others = change.deviceId !== device.deviceId && change.claimId !== device.claimId;
    return moved && others ? [{ expense: change.expense, action, author, moved }] : [];
  });
  const latest = news.at(-1);
  if (!latest) return null;
  const { expense, action, author, moved } = latest;
  return {
    tripId: trip.id,
    tripName: trip.name,
    currency: trip.currency,
    count: news.length,
    latest: {
      expenseId: expense.id,
      title: expense.title,
      author,
      action,
      paid: roundMoney(moved.paid, trip.currency).decimal,
      share: roundMoney(moved.share, trip.currency).decimal,
    },
  };
}

/** What a change did to its Expense, as a notification says. */
function actionOf(
  change: ExpenseChange,
  version: number,
  before: Expense | null,
): PushMessage['latest']['action'] {
  if (change.deleted) return 'deleted';
  if (version === 1) return 'added';
  // Not there before, though it had a version: it was deleted.
  return before === null ? 'restored' : 'changed';
}

/**
 * What each changed Expense was before its change, by change id: the Revision before the one
 * it made, or `null` when it was new or deleted.
 */
async function expensesBefore(
  applied: readonly AppliedExpenseChange[],
): Promise<Map<string, Expense | null>> {
  const edits = applied.filter(({ version }) => version > 1);
  if (edits.length === 0) return new Map();
  const rows = await getDb()
    .select({
      expenseId: revisions.expenseId,
      version: revisions.version,
      state: revisions.state,
      deleted: revisions.deleted,
    })
    .from(revisions)
    .where(
      or(
        ...edits.map(({ change, version }) =>
          and(eq(revisions.expenseId, change.expense.id), eq(revisions.version, version - 1)),
        ),
      ),
    );
  return new Map(
    edits.map(({ change, version }) => {
      const row = rows.find((r) => r.expenseId === change.expense.id && r.version === version - 1);
      const expense = row && !row.deleted ? { ...row.state, id: row.expenseId } : null;
      return [change.id, expense];
    }),
  );
}

/**
 * Sends one push message, encrypted for the subscription, and resolves to the push service's
 * status, or `null` when it can't be reached. `web-push` builds the request; it is sent with
 * `fetch` here, which also speaks the plain http of the api e2e suite's stand-in.
 */
async function send(
  subscription: webpush.PushSubscription,
  message: PushMessage,
  vapidDetails: webpush.VapidKeys & { subject: string },
): Promise<number | null> {
  const request = webpush.generateRequestDetails(subscription, JSON.stringify(message), {
    vapidDetails,
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
    console.warn('A push notification could not be sent', error);
    return null;
  }
}
