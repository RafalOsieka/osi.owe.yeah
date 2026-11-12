import {
  expenseChangeProblems,
  isRepayment,
  expensesReferencing,
  PUSH_LIMIT,
  tripCurrencyLocked,
  type ChangeResult,
  type Currency,
  type Expense,
  type ExpenseProblem,
  type Participant,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type RateEntry,
  type RateLookup,
  type ReminderRefusal,
  type ReminderRequest,
  type ReminderStatus,
  type Revision,
  type SubscriptionRequest,
  type SyncChange,
  type Trip,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { computed, shallowReactive } from 'vue';
import {
  NOTIFICATIONS_OFF,
  type BrowserSubscription,
  type DeviceDb,
  type DeviceTrip,
  type ExpenseBase,
  type Held,
  type Notice,
  queuedChangeSchema,
  type OutboxEntry,
  type QueuedChange,
} from './db';
import {
  findExpense,
  localTrip,
  withAccepted,
  withExpense,
  type LocalExpense,
  type LocalTrip,
} from './local-trip';
import { createNotifications } from './notifications';

/** A sync API call that got no answer back, e.g. with no signal. */
export class OfflineError extends Error {
  constructor() {
    super('No answer from the server');
  }
}

/**
 * How the device reaches the sync API. Every call rejects when no answer comes back (e.g. no
 * signal), `push` and `pull` with an `OfflineError`, and with another error for an answer they
 * can't take, such as a 5xx; `pull` answers `invalidLink` when the server refuses the token.
 */
export type Transport = {
  push(tripId: string, token: string, request: PushRequest): Promise<PushResponse>;
  pull(tripId: string, token: string, since?: number): Promise<PullResponse | 'invalidLink'>;
  /**
   * The automatic rate of `from` in the Trip currency on a local `date`, ahead of the pull;
   * also rejects when the server refuses the token.
   */
  lookupRate(tripId: string, token: string, from: Currency, date: string): Promise<RateLookup>;
  /** An Expense's Revisions, newest first. */
  revisions(tripId: string, token: string, expenseId: string): Promise<Revision[]>;
  /** Registers, or replaces, the device's push subscription to a Trip. */
  subscribe(
    tripId: string,
    token: string,
    deviceId: string,
    request: SubscriptionRequest,
  ): Promise<void>;
  /**
   * Removes the device's push subscription to a Trip; also resolves when the server refuses
   * the token, as then there is nothing to remove.
   */
  unsubscribe(tripId: string, token: string, deviceId: string): Promise<void>;
  /** Whom a Reminder can reach in the Trip, and the pairs reminded today. */
  reminderStatus(tripId: string, token: string): Promise<ReminderStatus>;
  /**
   * Sends a Reminder, never through the outbox, resolving to how the server answered. Rejects
   * on any other answer, such as a proxy's block or rate limit, as it does offline.
   */
  remind(tripId: string, token: string, request: ReminderRequest): Promise<Reminded>;
};

/**
 * How the server answered a Reminder: sent, or refused, as it doesn't suggest that
 * Repayment now, no device of the debtor's can be notified, or the pair was reminded today.
 */
export type Reminded = 'sent' | ReminderRefusal['refused'];

/** A Trip opened on this device, as it shows it. */
export type DeviceTripView = {
  deviceTrip: DeviceTrip;
  /** The Trip with this device's changes on top; `null` before a joined Trip's first pull. */
  local: LocalTrip | null;
  /** How many of this device's changes the server has not accepted yet. */
  unsynced: number;
};

/**
 * Why a Trip's last sync didn't get through: no answer came back (`offline`), or the server
 * answered with an error (`server`), such as a 5xx or a rate limit.
 */
export type SyncFailure = 'offline' | 'server';

/** A change about to be queued, before the device stamps it with its id, Claim and device. */
type NewChange = {
  [K in QueuedChange['kind']]: Omit<
    Extract<QueuedChange, { kind: K }>,
    'id' | 'claimId' | 'deviceId'
  >;
}[QueuedChange['kind']];

/** A Notice about to be kept, before it gets its id. */
type NewNotice = Notice extends infer N ? (N extends Notice ? Omit<N, 'id'> : never) : never;

/** An outbox entry holding an Expense change. */
type ExpenseEntry = OutboxEntry & { change: Extract<QueuedChange, { kind: 'expense' }> };

/**
 * The device's Trips and sync (ADR 0002): every change is written to the device store first
 * and queued in the outbox, and then syncs its Trip by itself; `sync` pushes the outbox in
 * order and pulls the Trip. Changes of a Trip go through its handle, `trip(tripId)`. Reads go
 * through `read`, which shows the outbox on top of the pulled Trip.
 */
export function createDevice(db: DeviceDb, transport: Transport, deviceId: string) {
  // Versions this session's accepted changes gave their Expenses, for an edit started
  // while the change it was based on was still in the outbox.
  const acceptedVersions = new Map<string, number>();
  // The sync running for each Trip, and whether a change was made meanwhile.
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  // Why each Trip's last sync failed, until one gets through; reactive, for the Trip header.
  const failures = shallowReactive(new Map<string, SyncFailure>());
  const notifications = createNotifications(db, transport, deviceId);

  async function entriesOf(tripId: string): Promise<OutboxEntry[]> {
    return db.outbox.where('tripId').equals(tripId).sortBy('seq');
  }

  /** One Expense's changes in the outbox, in order. Only the first can be held. */
  async function expenseEntries(tripId: string, expenseId: string): Promise<ExpenseEntry[]> {
    return (await entriesOf(tripId)).filter(
      (entry): entry is ExpenseEntry =>
        entry.change.kind === 'expense' && entry.change.expense.id === expenseId,
    );
  }

  async function read(tripId: string): Promise<DeviceTripView | undefined> {
    return db.transaction('r', db.trips, db.outbox, async () => {
      const deviceTrip = await db.trips.get(tripId);
      if (!deviceTrip) return undefined;
      const entries = await entriesOf(tripId);
      return {
        deviceTrip,
        local: localTrip(deviceTrip.snapshot, entries, deviceTrip.rates),
        unsynced: entries.length,
      };
    });
  }

  /** Every Trip opened on this device, most recently opened first. */
  async function readAll(): Promise<DeviceTripView[]> {
    const trips = await db.trips.toArray();
    const views = await Promise.all(trips.map(({ id }) => read(id)));
    return views
      .filter((view) => view !== undefined)
      .toSorted((a, b) => b.deviceTrip.openedAt.localeCompare(a.deviceTrip.openedAt));
  }

  /**
   * Queues a change in the outbox, stamped with its id, the device's Claim and the device, as
   * `queuedChangeSchema` outputs it. Throws for a change the server couldn't read: the forms
   * guard its shape, so that is a bug.
   */
  async function enqueue(tripId: string, change: NewChange): Promise<void> {
    const device = await db.trips.get(tripId);
    const queued = queuedChangeSchema.parse({
      ...change,
      id: uuidv7(),
      claimId: device?.claim?.id ?? null,
      deviceId,
    });
    await db.outbox.add({ tripId, change: queued, held: null });
  }

  /**
   * Starts a sync of a Trip after a change of it the server must hear about was written, without
   * waiting for it (ADR 0002); a sync of the Trip running already goes once more after it, as it
   * may have read the outbox before the change. The one place a change starts a sync.
   */
  function changed(tripId: string): void {
    if (running.has(tripId)) again.add(tripId);
    else void start(tripId);
  }

  /**
   * Creates a Trip on this device, maybe offline, with `token` as its Trip link's token. The
   * first Participant is the creator and becomes the Claim. It syncs by itself.
   */
  async function createTrip(trip: TripWithParticipants, token: string): Promise<void> {
    const { id, name, currency, participants } = trip;
    await db.transaction('rw', db.trips, db.outbox, async () => {
      await db.trips.add({
        id,
        token,
        claim: participants[0] ?? null,
        openedAt: new Date().toISOString(),
        snapshot: null,
        rates: [],
        lastCurrency: null,
        notices: [],
        notifications: NOTIFICATIONS_OFF,
      });
      await enqueue(id, { kind: 'trip', trip: { name, currency } });
      for (const participant of participants)
        await enqueue(id, { kind: 'participant', participant, removed: false });
    });
    changed(id);
  }

  /**
   * Opens a Trip from its Trip link on this device, keeping any Claim it had: pulls it with
   * `token` and keeps it on the device. Needs a connection.
   */
  async function joinTrip(
    tripId: string,
    token: string,
  ): Promise<'joined' | 'invalidLink' | 'unreachable'> {
    const pulled = await transport.pull(tripId, token).catch(() => null);
    if (pulled === null) return 'unreachable';
    if (pulled === 'invalidLink' || !pulled.trip) return 'invalidLink';
    const { trip: serverTrip, rates } = pulled;
    await db.transaction('rw', db.trips, async () => {
      const known = await db.trips.get(tripId);
      await db.trips.put({
        id: tripId,
        token,
        claim: known?.claim ?? null,
        openedAt: new Date().toISOString(),
        snapshot: serverTrip,
        rates: cachedRates(known?.rates ?? [], rates),
        lastCurrency: known?.lastCurrency ?? null,
        notices: known?.notices ?? [],
        notifications: known?.notifications ?? NOTIFICATIONS_OFF,
      });
    });
    return 'joined';
  }

  /**
   * Takes the browser's push subscription as it is now, e.g. renewed by the browser, for every
   * Trip with notifications on; each of those syncs by itself.
   */
  async function renewSubscription(subscription: BrowserSubscription): Promise<void> {
    for (const tripId of await notifications.renew(subscription)) changed(tripId);
  }

  /**
   * Keeps Notices for the Trip until they are dismissed. A Notice the Trip keeps already is
   * not kept twice, e.g. a new Trip currency refused for two queued changes that carried it.
   */
  async function notify(tripId: string, ...notices: NewNotice[]): Promise<void> {
    if (notices.length === 0) return;
    const device = await db.trips.get(tripId);
    if (!device) return;
    const kept = [...device.notices];
    const said = new Set(kept.map(({ id: _, ...notice }) => JSON.stringify(notice)));
    for (const notice of notices) {
      const key = JSON.stringify(notice);
      if (said.has(key)) continue;
      said.add(key);
      kept.push({ ...notice, id: uuidv7() });
    }
    await db.trips.update(tripId, { notices: kept });
  }

  /**
   * Queues an Expense's full new state, on the base the Expense had as the user read it
   * (`asRead`, `null` for a new one), unless it breaks a Trip rule. See the handle's
   * `saveExpense`.
   */
  async function queueExpense(
    tripId: string,
    expense: Expense,
    asRead: LocalExpense | null,
    deleted: boolean,
  ): Promise<ExpenseProblem[]> {
    return db.transaction('rw', db.trips, db.outbox, async () => {
      const local = await readLocal(tripId);
      const problems = expenseChangeProblems({ expense }, local);
      if (problems.length > 0) return problems;

      const entries = await expenseEntries(tripId, expense.id);
      const rejected = entries[0]?.held?.status === 'rejected' ? entries[0] : null;
      if (rejected) await db.outbox.bulkDelete(entries.map(({ seq }) => seq));
      await enqueue(tripId, {
        kind: 'expense',
        base: rejected
          ? rejected.change.base
          : resolveBase(local, expense.id, asRead?.base ?? { version: null }),
        expense,
        deleted,
      });
      return [];
    });
  }

  /**
   * The base a new change of an Expense goes on. Behind the Expense's last change still in
   * the outbox, if there is one. An edit started on a change accepted meanwhile takes the
   * version it got (or, from another tab, the version the device has now).
   */
  function resolveBase(trip: LocalTrip, expenseId: string, base: ExpenseBase): ExpenseBase {
    const current = findExpense(trip, expenseId)?.base ?? { version: null };
    if ('after' in current) return current;
    if ('after' in base) return { version: acceptedVersions.get(base.after) ?? current.version };
    return base;
  }

  /** The Trip as this device keeps it, for a call to the server; rejects if it is not here. */
  async function tripOnDevice(tripId: string): Promise<DeviceTrip> {
    const device = await db.trips.get(tripId);
    if (!device) throw new Error(`Trip ${tripId} is not on this device`);
    return device;
  }

  /**
   * One Trip on this device, its id bound: what the open Trip offers its pages. Every change
   * the server must hear about syncs the Trip by itself once it is written, and resolves
   * without waiting for that sync.
   */
  function trip(tripId: string) {
    // `change`, after which the Trip syncs, unless its result says nothing was written.
    const syncing =
      <A extends unknown[], R>(
        change: (...args: A) => Promise<R>,
        written: (result: R) => boolean = () => true,
      ) =>
      async (...args: A): Promise<R> => {
        const result = await change(...args);
        if (written(result)) changed(tripId);
        return result;
      };
    const refusedNothing = (problems: ExpenseProblem[]) => problems.length === 0;

    return {
      /** Records that the Trip was opened now, for My Trips' order, and syncs it. */
      async open(): Promise<void> {
        await db.trips.update(tripId, { openedAt: new Date().toISOString() });
        void sync(tripId);
      },

      /**
       * Forgets the Trip on this device, with its Claim and every change not synced yet: those
       * are lost. The Trip and its Participants stay on the server; the Trip link opens it
       * again. A push subscription the server may have goes on a later `syncForgotten`.
       */
      async forget(): Promise<void> {
        await db.transaction('rw', db.trips, db.outbox, db.forgotten, async () => {
          const device = await db.trips.get(tripId);
          if (device) await notifications.forget(device);
          await db.outbox.where('tripId').equals(tripId).delete();
          await db.trips.delete(tripId);
        });
        failures.delete(tripId);
      },

      /**
       * Sets which Participant this device is in the Trip. The server's push subscription
       * follows it while notifications are on, so then the Trip syncs.
       */
      async claim(participant: Participant): Promise<void> {
        const device = await db.transaction('rw', db.trips, async () => {
          await db.trips.update(tripId, { claim: participant });
          return db.trips.get(tripId);
        });
        if (device?.notifications.subscription) changed(tripId);
      },

      /**
       * Turns push notifications on for the Trip with the browser's subscription. The server
       * gets it for the device's Claim, as long as it has one.
       */
      turnOnNotifications: syncing((subscription: BrowserSubscription) =>
        notifications.set(tripId, { subscription, offered: true }),
      ),

      /** Turns push notifications off for the Trip. */
      turnOffNotifications: syncing(() =>
        notifications.set(tripId, { subscription: null, offered: true }),
      ),

      /** "Not now" to the offer of notifications after a Claim: never offered again by itself. */
      declineNotifications: (): Promise<void> => notifications.set(tripId, { offered: true }),

      /** Adds or renames a Participant. */
      addParticipant: syncing((participant: Participant) =>
        enqueue(tripId, { kind: 'participant', participant, removed: false }),
      ),

      /**
       * Removes a Participant softly, unless an Expense (deleted ones aside) references them.
       * Resolves to how many do: 0 when they were removed.
       */
      removeParticipant: syncing(
        (participant: Participant) =>
          db.transaction('rw', db.trips, db.outbox, async () => {
            const local = await readLocal(tripId);
            const referencing = expensesReferencing(local.expenses, participant.id);
            if (referencing === 0) {
              await enqueue(tripId, { kind: 'participant', participant, removed: true });
            }
            return referencing;
          }),
        (referencing) => referencing === 0,
      ),

      /**
       * Saves the Trip's name and Trip currency, last write wins. A new Trip currency rewrites
       * no Expense: each is converted at the rate for the new pair (ADR 0003). Once the Trip
       * has a Repayment, a new Trip currency is refused (`tripCurrencyLocked`) and nothing is
       * saved. Resolves to whether the details were saved.
       */
      saveTripDetails: syncing(
        (details: Omit<Trip, 'id'>) =>
          db.transaction('rw', db.trips, db.outbox, async () => {
            const local = await readLocal(tripId);
            const locked = tripCurrencyLocked(local.expenses);
            if (details.currency !== local.currency && locked) return false;
            await enqueue(tripId, { kind: 'trip', trip: details });
            return true;
          }),
        (saved) => saved,
      ),

      /** Dismisses one of the Trip's Notices. */
      async dismissNotice(noticeId: string): Promise<void> {
        await db.transaction('rw', db.trips, async () => {
          const device = await db.trips.get(tripId);
          if (!device) return;
          const notices = device.notices.filter(({ id }) => id !== noticeId);
          await db.trips.update(tripId, { notices });
        });
      },

      /**
       * Saves an Expense's full new state, based on the Expense as the user read it before
       * editing (`asRead`, `null` for a new one): a version someone else made meanwhile ends in
       * a Conflict, even once pulled. Resolves to the Trip rules it breaks, in which case
       * nothing is saved. An Expense in Conflict keeps the edit on this device's version; one
       * with a rejected change takes the edit as its fix, sent in place of the rejected
       * changes. Saving a deleted Expense, or an older Revision, restores it. A new Expense on
       * this device starts in the currency of the one saved last (`lastCurrency`), Repayments
       * aside.
       */
      saveExpense: syncing(
        async (expense: Expense, asRead: LocalExpense | null): Promise<ExpenseProblem[]> => {
          const problems = await queueExpense(tripId, expense, asRead, false);
          if (problems.length === 0 && !isRepayment(expense)) {
            await db.trips.update(tripId, { lastCurrency: expense.currency });
          }
          return problems;
        },
        refusedNothing,
      ),

      /**
       * Deletes an Expense softly: it moves to Recently deleted, keeping its state, and saving
       * it again restores it. Otherwise like `saveExpense`.
       */
      deleteExpense: syncing(
        (expense: Expense, asRead: LocalExpense | null) =>
          queueExpense(tripId, expense, asRead, true),
        refusedNothing,
      ),

      /**
       * Resolves an Expense's Conflict with this device's version: its changes go again on top
       * of the version the Conflict showed.
       */
      keepMine: syncing(async (expenseId: string): Promise<void> => {
        await db.transaction('rw', db.outbox, async () => {
          const [first] = await expenseEntries(tripId, expenseId);
          if (first?.held?.status !== 'conflict') return;
          const base = { version: first.held.current.version };
          await db.outbox.update(first.seq, { change: { ...first.change, base }, held: null });
        });
      }),

      /**
       * Drops every change of an Expense this device has not synced: "keep theirs" for a
       * Conflict, whose version shows at once, or "discard" for a rejected change.
       */
      async discardChanges(expenseId: string): Promise<void> {
        await db.transaction('rw', db.trips, db.outbox, async () => {
          const entries = await expenseEntries(tripId, expenseId);
          await db.outbox.bulkDelete(entries.map(({ seq }) => seq));
          const held = entries[0]?.held;
          const device = await db.trips.get(tripId);
          if (held?.status !== 'conflict' || !device?.snapshot) return;
          const shown = device.snapshot.expenses.find(({ id }) => id === expenseId);
          // A pull may have brought a newer version already.
          if (shown && shown.version >= held.current.version) return;
          await db.trips.update(tripId, { snapshot: withExpense(device.snapshot, held.current) });
        });
      },

      /** An Expense's Revisions from the server, newest first. Rejects without a connection. */
      async revisions(expenseId: string): Promise<Revision[]> {
        const device = await tripOnDevice(tripId);
        return transport.revisions(tripId, device.token, expenseId);
      },

      /**
       * The automatic rate of `from` in the Trip currency on a local `date`, from the server's
       * rate table ahead of the pull, for the Expense form (ADR 0003). A found entry is kept
       * with the Trip's rates, so an Expense saved with it converts before the next pull.
       * Rejects offline, and before the Trip reached the server.
       */
      async lookupRate(from: Currency, date: string): Promise<RateLookup> {
        const device = await tripOnDevice(tripId);
        const lookup = await transport.lookupRate(tripId, device.token, from, date);
        if (lookup.status !== 'found') return lookup;
        await db.transaction('rw', db.trips, async () => {
          const current = await db.trips.get(tripId);
          if (!current) return;
          await db.trips.update(tripId, { rates: cachedRates(current.rates, [lookup.entry]) });
        });
        return lookup;
      },

      /** Whom a Reminder can reach in the Trip, and who was reminded today. Rejects offline. */
      async reminderStatus(): Promise<ReminderStatus> {
        const device = await tripOnDevice(tripId);
        return transport.reminderStatus(tripId, device.token);
      },

      /**
       * Reminds `to` of the Suggested Repayment they owe this device's Claim (#42): a call of
       * its own, never queued. Rejects offline, as the creditor then shares a message instead.
       */
      async remind(to: string): Promise<Reminded> {
        const device = await tripOnDevice(tripId);
        if (!device.claim) return 'notSuggested';
        return transport.remind(tripId, device.token, { from: device.claim.id, to });
      },

      /**
       * Why the Trip's last sync failed on this device, kept in memory only: `null` until one
       * fails, and again once one gets through.
       */
      lastFailure: computed(() => failures.get(tripId) ?? null),

      /** Syncs the Trip now, e.g. on pull-to-refresh, as `sync` does. */
      sync: (): Promise<void> => sync(tripId),
    };
  }

  /**
   * Pushes the Trip's outbox and pulls the Trip, or joins the sync of it running already. A
   * change needs no call: it syncs by itself. Never rejects: whatever doesn't get through
   * waits for the next sync.
   */
  function sync(tripId: string): Promise<void> {
    return running.get(tripId) ?? start(tripId);
  }

  /** Starts a sync of the Trip, run once more for every change made meanwhile (`changed`). */
  function start(tripId: string): Promise<void> {
    const run = (async () => {
      do {
        again.delete(tripId);
        await syncOnce(tripId).then(
          () => failures.delete(tripId),
          (error) => failures.set(tripId, error instanceof OfflineError ? 'offline' : 'server'),
        );
      } while (again.has(tripId));
      // Right after the last check, so a change made from now on starts a sync of its own.
      running.delete(tripId);
    })();
    running.set(tripId, run);
    return run;
  }

  /** The Trip as this device shows it, for a change made on it. */
  async function readLocal(tripId: string): Promise<LocalTrip> {
    const local = (await read(tripId))?.local;
    if (!local) throw new Error(`Trip ${tripId} is not on this device`);
    return local;
  }

  async function syncOnce(tripId: string): Promise<void> {
    const device = await db.trips.get(tripId);
    if (!device) return;
    // An accepted change can free the next change of its Expense, so push until none is.
    while (await pushRound(device)) {
      /* keep pushing */
    }
    const pulled = await transport.pull(tripId, device.token, device.snapshot?.version);
    if (pulled === 'invalidLink') return;
    const { trip: serverTrip } = pulled;
    const rates = cachedRates(device.rates, pulled.rates);
    if (serverTrip) {
      await db.transaction('rw', db.trips, db.outbox, async () => {
        await db.trips.update(tripId, { snapshot: serverTrip, rates });
        await dropRemovedClaim(tripId);
      });
    } else {
      await db.trips.update(tripId, { rates });
    }
    // Last: a Trip created offline exists on the server only after its push. Its failure is no
    // failure of the Trip's sync: a push service the server refuses would never clear it.
    await notifications.reconcile(tripId).catch(() => {});
  }

  /**
   * Drops the Claim of a Participant someone else removed, unless a change still on this
   * device brings them back, and notes it so the device is asked "Who are you?" again.
   */
  async function dropRemovedClaim(tripId: string): Promise<void> {
    const view = await read(tripId);
    const claim = view?.deviceTrip.claim;
    if (!claim || !view.local?.removedParticipants.some(({ id }) => id === claim.id)) return;
    await db.trips.update(tripId, { claim: null });
    await notify(tripId, { kind: 'claimRemoved', participant: claim });
  }

  /**
   * Sends every change that can go now: not held, and for an Expense, on a known base. One
   * Expense's changes go one per push, each on the version the last one got. A Conflict goes
   * again once a pull brought a newer version than it showed, so the answer shows that one.
   * Resolves to whether anything was accepted.
   */
  async function pushRound({ id: tripId, token }: DeviceTrip): Promise<boolean> {
    // Read again: a push round before this one may have taken its changes in.
    const serverTrip = (await db.trips.get(tripId))?.snapshot;
    const pulled = new Map(serverTrip?.expenses.map(({ id, version }) => [id, version]));
    const outdated = (held: Held) =>
      held.status === 'conflict' && (pulled.get(held.current.id) ?? 0) > held.current.version;
    const ready = (await entriesOf(tripId))
      .filter(
        ({ change, held }) =>
          (!held || outdated(held)) && (change.kind !== 'expense' || 'version' in change.base),
      )
      .slice(0, PUSH_LIMIT);
    if (ready.length === 0) return false;

    const { results } = await transport.push(tripId, token, {
      changes: ready.map(({ change }) => toSyncChange(change)),
    });

    const known = [...(serverTrip?.participants ?? []), ...(serverTrip?.removedParticipants ?? [])];
    let accepted = false;
    await db.transaction('rw', db.trips, db.outbox, async () => {
      for (const result of results) {
        const entry = ready.find(({ change }) => change.id === result.changeId);
        if (!entry) continue;
        await notify(tripId, ...noticesFor(entry.change, result, known));
        if (result.status === 'accepted') {
          accepted = true;
          await accept(entry, result.version);
        } else if (entry.change.kind === 'expense') {
          await db.outbox.update(entry.seq, { held: result });
        } else {
          // Refused Trip details and Participants are dropped: the pull shows what stands.
          await db.outbox.delete(entry.seq);
        }
      }
    });
    return accepted;
  }

  /**
   * Takes an accepted change out of the outbox into the `ServerTrip`. The Expense's next change
   * now has a base: the version this one got.
   */
  async function accept(entry: OutboxEntry, version: number | null): Promise<void> {
    const { tripId, change } = entry;
    await db.outbox.delete(entry.seq);
    const device = await db.trips.get(tripId);
    await db.trips.update(tripId, {
      snapshot: withAccepted(device?.snapshot ?? null, tripId, change, version),
    });
    if (change.kind !== 'expense' || version === null) return;

    acceptedVersions.set(change.id, version);
    const next = (await entriesOf(tripId)).find(
      (other) =>
        other.change.kind === 'expense' &&
        'after' in other.change.base &&
        other.change.base.after === change.id,
    );
    if (next?.change.kind === 'expense') {
      await db.outbox.update(next.seq, { change: { ...next.change, base: { version } } });
    }
  }

  return {
    read,
    readAll,
    createTrip,
    joinTrip,
    renewSubscription,
    trip,
    sync,
    /** Removes the server's push subscriptions of Trips forgotten here. Never rejects. */
    syncForgotten: notifications.removeAllForgotten,
  };
}

export type Device = ReturnType<typeof createDevice>;

/** One Trip on this device, its id bound (`device.trip(tripId)`). */
export type TripHandle = ReturnType<Device['trip']>;

/**
 * The device's cached rate entries with those a pull or a lookup brought: each of those
 * replaces the one for its date and pair, and the rest stay, so a pair the Trip no longer needs
 * keeps its latest cached rate for a Provisional rate later, e.g. offline.
 */
function cachedRates(cached: readonly RateEntry[], pulled: readonly RateEntry[]): RateEntry[] {
  const key = ({ date, from, to }: RateEntry) => `${date} ${from} ${to}`;
  const brought = new Set(pulled.map(key));
  return [...cached.filter((entry) => !brought.has(key(entry))), ...pulled];
}

/** A queued change as the push sends it: an Expense change's base is known by now. */
function toSyncChange(change: QueuedChange): SyncChange {
  if (change.kind !== 'expense') return change;
  const { base, ...rest } = change;
  if (!('version' in base)) throw new Error(`Change ${change.id} is not ready to send`);
  return { ...rest, baseVersion: base.version };
}

/**
 * What the user should hear about a change's result: removed Participants an accepted
 * Expense brought back (named as `known` has them), a removal the server refused, a new
 * Trip currency it refused for a Repayment recorded meanwhile, a change of the Trip details
 * or of a Participant it couldn't read, or a Participant it refused because the Trip is full. A
 * refused Expense change is held and shown on the Expense instead.
 */
function noticesFor(
  change: QueuedChange,
  result: ChangeResult,
  known: readonly Participant[],
): NewNotice[] {
  if (result.status === 'accepted') {
    if (change.kind !== 'expense') return [];
    const expenseTitle = change.expense.title;
    return known
      .filter(({ id }) => result.restored?.includes(id))
      .map((participant) => ({ kind: 'participantRestored', participant, expenseTitle }));
  }
  if (result.status !== 'rejected') return [];
  if (result.problems.includes('malformed')) {
    const { kind } = change;
    if (kind === 'trip') return [{ kind: 'changeRefused', about: { kind, trip: change.trip } }];
    if (kind === 'expense') return [];
    return [{ kind: 'changeRefused', about: { kind, participant: change.participant } }];
  }
  if (change.kind === 'participant' && result.problems.includes('participantReferenced')) {
    return [{ kind: 'removalRefused', participant: change.participant }];
  }
  if (change.kind === 'participant' && result.problems.includes('tooManyParticipants')) {
    return [{ kind: 'tooManyParticipants', participant: change.participant }];
  }
  if (change.kind === 'trip' && result.problems.includes('tripHasRepayments')) {
    return [{ kind: 'currencyChangeRefused', currency: change.trip.currency }];
  }
  return [];
}
