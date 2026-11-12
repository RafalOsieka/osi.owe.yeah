import {
  balanceChanges,
  revisionKind,
  roundMoney,
  type BalanceChange,
  type Expense,
  type ExpenseChange,
  type ActivityMessage,
  type RevisionKind,
  type Trip,
} from '@osi/owe-yeah-domain';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { notificationSubscriptions } from '../db/schema';
import type { Rates } from '../trip/rates';
import type { TripStore, WholeTrip } from '../trip/store';
import type { AppliedExpenseChange, Notifier } from '../trip/sync';
import { deliver, type PushSettings } from './delivery';

/** One applied change as Notifications tell it: what it did, who made it, whom it moved. */
type Activity = {
  change: ExpenseChange;
  action: RevisionKind;
  author: string | null;
  affected: ReadonlyMap<string, BalanceChange>;
};

/**
 * Notifications about Expense changes (#41), the Trip sync's `Notifier` in production: reading
 * the Trip through `store` and converting at `rates`, with subscriptions kept in `db`. Sent
 * with `pushSettings`; nothing is sent without them.
 */
export function createNotifications(
  db: Database,
  store: TripStore,
  rates: Rates,
  pushSettings: PushSettings | null,
): Notifier {
  /**
   * What each changed Expense was before its change, by change id: the Revision before the
   * one it made, or `null` when it was new or deleted.
   */
  async function expensesBefore(
    tripId: string,
    applied: readonly AppliedExpenseChange[],
  ): Promise<Map<string, Expense | null>> {
    const edits = applied.filter(({ version }) => version > 1);
    return new Map(
      await Promise.all(
        edits.map(async ({ change, version }) => {
          const history = await store.revisions(tripId, change.expense.id);
          const revision = history.find((r) => r.version === version - 1);
          const expense = revision && !revision.deleted ? revision.expense : null;
          return [change.id, expense] as const;
        }),
      ),
    );
  }

  /**
   * Each applied change with whom it affects (`balanceChanges`), from the Expense as its
   * Revision before showed it and as the change left it, converted at the Trip's rates.
   */
  async function activitiesOf(
    trip: WholeTrip,
    applied: readonly AppliedExpenseChange[],
  ): Promise<Activity[]> {
    const { participants } = trip;
    const names = new Map(participants.map(({ id, name }) => [id, name]));
    const before = await expensesBefore(trip.id, applied);
    const changed = applied.map(({ change, version }) => ({
      change,
      version,
      was: before.get(change.id) ?? null,
      now: change.deleted ? null : change.expense,
    }));
    const entries = await rates.forExpenses(
      changed.flatMap(({ was, now }) => [was, now]).filter((expense) => expense !== null),
      trip.currency,
    );
    return changed.map(({ change, version, was, now }) => ({
      change,
      // What it did (`revisionKind`): with a version before it but no live Expense, the Revision
      // before it was deleted.
      action: revisionKind(version === 1 ? null : { deleted: was === null }, change.deleted),
      author: change.claimId ? (names.get(change.claimId) ?? null) : null,
      affected: new Map(
        balanceChanges({ currency: trip.currency, participants, rates: entries }, was, now).map(
          (moved) => [moved.participantId, moved],
        ),
      ),
    }));
  }

  async function notify(tripId: string, applied: readonly AppliedExpenseChange[]): Promise<void> {
    if (applied.length === 0 || !pushSettings) return;
    const subscriptions = await db
      .select()
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.tripId, tripId));
    if (subscriptions.length === 0) return;

    const trip = await store.readTrip(tripId);
    if (!trip) return;
    const activities = await activitiesOf(trip, applied);
    await deliver(
      db,
      subscriptions,
      (device) => messageFor(trip, activities, device),
      pushSettings,
    );
  }

  return {
    /**
     * Tells the devices subscribed to a Trip about the Expense changes a sync push has just
     * applied, fire-and-forget once the push has answered. A device hears about a change that
     * affects the Participant it claims (`balanceChanges`), made under another Claim on
     * another device: one Notification for the whole push, about the latest of them and how
     * many there were. Conflicts and refused changes never get here, and nothing is said
     * about a Trip becoming Settled. Subscriptions whose push service answers 404 or 410 are
     * deleted. Nothing is retried: a lost Notification is fine, as the next pull brings the
     * change. Never rejects.
     */
    async notifyAffected(tripId: string, applied: readonly AppliedExpenseChange[]): Promise<void> {
      try {
        await notify(tripId, applied);
      } catch (error) {
        console.warn('Notifications could not be worked out', error);
      }
    },
  };
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
): ActivityMessage | null {
  const news = activities.flatMap(({ change, action, author, affected }) => {
    const moved = affected.get(device.claimId);
    const others = change.deviceId !== device.deviceId && change.claimId !== device.claimId;
    return moved && others ? [{ expense: change.expense, action, author, moved }] : [];
  });
  const latest = news.at(-1);
  if (!latest) return null;
  const { expense, action, author, moved } = latest;
  return {
    kind: 'activity',
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
