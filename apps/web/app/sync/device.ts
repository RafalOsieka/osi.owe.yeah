import {
  expenseProblems,
  isRepayment,
  expensesReferencing,
  type ChangeResult,
  type Expense,
  type ExpenseProblem,
  type Participant,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type RateEntry,
  type ReminderRequest,
  type ReminderStatus,
  type Revision,
  type SubscriptionRequest,
  type SyncChange,
  type Trip,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import {
  NOTIFICATIONS_OFF,
  type BrowserSubscription,
  type DeviceDb,
  type DeviceNotifications,
  type DeviceTrip,
  type ExpenseBase,
  type ForgottenTrip,
  type Held,
  type Notice,
  type OutboxEntry,
  type QueuedChange,
} from './db';
import { findExpense, localTrip, withAccepted, withExpense, type LocalTrip } from './local-trip';

/**
 * How the device reaches the sync API. Every call rejects when no answer comes back (e.g. no
 * signal); `pull` answers `invalidLink` when the server refuses the token.
 */
export type Transport = {
  push(tripId: string, token: string, request: PushRequest): Promise<PushResponse>;
  pull(tripId: string, token: string, since?: number): Promise<PullResponse | 'invalidLink'>;
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
  /** Sends a Reminder, never through the outbox, resolving to how the server answered. */
  remind(tripId: string, token: string, request: ReminderRequest): Promise<Reminded>;
};

/**
 * How the server answered a Reminder: sent, or refused, as it doesn't suggest that
 * Repayment now, no device of the debtor's can be notified, or the pair was reminded today.
 */
export type Reminded = 'sent' | 'notSuggested' | 'unreachable' | 'remindedToday';

/** A Trip opened on this device, as it shows it. */
export type DeviceTripView = {
  deviceTrip: DeviceTrip;
  /** The Trip with this device's changes on top; `null` before a joined Trip's first pull. */
  local: LocalTrip | null;
  /** How many of this device's changes the server has not accepted yet. */
  unsynced: number;
};

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

// One push holds at most this many changes (`pushRequestSchema`).
const PUSH_LIMIT = 100;

/**
 * The device's Trips and sync (ADR 0002): every change is written to the device store first
 * and queued in the outbox; `sync` pushes the outbox in order and pulls the Trip. Reads go
 * through `read`, which shows the outbox on top of the pulled Trip.
 */
export function createDevice(db: DeviceDb, transport: Transport, deviceId: string) {
  // Versions this session's accepted changes gave their Expenses, for an edit started
  // while the change it was based on was still in the outbox.
  const acceptedVersions = new Map<string, number>();
  // The sync running for each Trip, and whether another was asked for meanwhile.
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  // The Trips whose push subscription the server took during this run of the app.
  const subscribedThisRun = new Set<string>();

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

  async function enqueue(tripId: string, change: NewChange): Promise<void> {
    const device = await db.trips.get(tripId);
    // SAFETY: `NewChange` is a `QueuedChange` without the fields added here.
    const queued = {
      ...change,
      id: uuidv7(),
      claimId: device?.claim?.id ?? null,
      deviceId,
    } as QueuedChange;
    await db.outbox.add({ tripId, change: queued, held: null });
  }

  /**
   * Creates a Trip on this device, maybe offline, with `token` as its Trip link's token. The
   * first Participant is the creator and becomes the Claim. It reaches the server on sync.
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
    const { trip: snapshot, rates } = pulled;
    await db.transaction('rw', db.trips, async () => {
      const known = await db.trips.get(tripId);
      await db.trips.put({
        id: tripId,
        token,
        claim: known?.claim ?? null,
        openedAt: new Date().toISOString(),
        snapshot,
        rates: cachedRates(known?.rates ?? [], rates),
        lastCurrency: known?.lastCurrency ?? null,
        notices: known?.notices ?? [],
        notifications: known?.notifications ?? NOTIFICATIONS_OFF,
      });
    });
    return 'joined';
  }

  /**
   * Forgets a Trip on this device, with its Claim and every change not synced yet: those are
   * lost. The Trip and its Participants stay on the server; the Trip link opens it again. A
   * push subscription the server may have goes on a later sync (`syncForgotten`).
   */
  async function forgetTrip(tripId: string): Promise<void> {
    await db.transaction('rw', db.trips, db.outbox, db.forgotten, async () => {
      const device = await db.trips.get(tripId);
      const { subscription, registered } = device?.notifications ?? NOTIFICATIONS_OFF;
      if (device && (subscription || registered)) {
        await db.forgotten.put({ tripId, token: device.token });
      }
      await db.outbox.where('tripId').equals(tripId).delete();
      await db.trips.delete(tripId);
    });
  }

  /** Records that a Trip on this device was opened now, for My Trips' order. */
  async function open(tripId: string): Promise<void> {
    await db.trips.update(tripId, { openedAt: new Date().toISOString() });
  }

  /** Changes a Trip's push notifications on this device; the server hears on sync. */
  async function setNotifications(
    tripId: string,
    change: Partial<DeviceNotifications>,
  ): Promise<void> {
    await db.transaction('rw', db.trips, async () => {
      const device = await db.trips.get(tripId);
      if (!device) return;
      await db.trips.update(tripId, { notifications: { ...device.notifications, ...change } });
    });
  }

  /**
   * Turns push notifications on for a Trip on this device, with the browser's subscription.
   * The server gets it on sync, for the device's Claim, as long as it has one.
   */
  function turnOnNotifications(tripId: string, subscription: BrowserSubscription): Promise<void> {
    return setNotifications(tripId, { subscription, offered: true });
  }

  /** Turns push notifications off for a Trip on this device; the server hears on sync. */
  function turnOffNotifications(tripId: string): Promise<void> {
    return setNotifications(tripId, { subscription: null, offered: true });
  }

  /**
   * Takes the browser's push subscription as it is now, e.g. renewed by the browser, for every
   * Trip with notifications on; the server gets it on sync.
   */
  async function renewSubscription(subscription: BrowserSubscription): Promise<void> {
    await db.transaction('rw', db.trips, async () => {
      for (const device of await db.trips.toArray()) {
        const kept = device.notifications.subscription;
        if (!kept || kept.endpoint === subscription.endpoint) continue;
        await db.trips.update(device.id, {
          notifications: { ...device.notifications, subscription },
        });
      }
    });
  }

  /** "Not now" to the offer of notifications after a Claim: never offered again by itself. */
  function declineNotifications(tripId: string): Promise<void> {
    return setNotifications(tripId, { offered: true });
  }

  /** Sets which Participant this device is in a Trip. */
  async function claim(tripId: string, participant: Participant): Promise<void> {
    await db.trips.update(tripId, { claim: participant });
  }

  /** Adds or renames a Participant on this device; it reaches the server on sync. */
  async function addParticipant(tripId: string, participant: Participant): Promise<void> {
    await enqueue(tripId, { kind: 'participant', participant, removed: false });
  }

  /**
   * Removes a Participant softly on this device, unless an Expense (deleted ones aside)
   * references them. Resolves to how many do: 0 when the removal was queued.
   */
  async function removeParticipant(tripId: string, participant: Participant): Promise<number> {
    return db.transaction('rw', db.trips, db.outbox, async () => {
      const local = await readLocal(tripId);
      const referencing = expensesReferencing(local.expenses, participant.id);
      if (referencing === 0) {
        await enqueue(tripId, { kind: 'participant', participant, removed: true });
      }
      return referencing;
    });
  }

  /**
   * Saves the Trip's name and Trip currency on this device, last write wins. A new Trip
   * currency rewrites no Expense: each is converted at the rate for the new pair (ADR 0003).
   */
  async function saveTripDetails(tripId: string, details: Omit<Trip, 'id'>): Promise<void> {
    await enqueue(tripId, { kind: 'trip', trip: details });
  }

  /** Keeps Notices for the Trip until they are dismissed. */
  async function notify(tripId: string, ...notices: NewNotice[]): Promise<void> {
    if (notices.length === 0) return;
    const device = await db.trips.get(tripId);
    if (!device) return;
    const added = notices.map((notice) => ({ ...notice, id: uuidv7() }));
    await db.trips.update(tripId, { notices: [...device.notices, ...added] });
  }

  /** Dismisses one of the Trip's Notices. */
  async function dismissNotice(tripId: string, noticeId: string): Promise<void> {
    await db.transaction('rw', db.trips, async () => {
      const device = await db.trips.get(tripId);
      if (!device) return;
      const notices = device.notices.filter(({ id }) => id !== noticeId);
      await db.trips.update(tripId, { notices });
    });
  }

  /**
   * Saves an Expense's full new state on this device, based on what the user edited (the
   * Expense's `base` as `read` showed it). Resolves to the Trip rules it breaks, in which case
   * nothing is saved; it reaches the server on sync. An Expense in Conflict keeps the edit on
   * this device's version; one with a rejected change takes the edit as its fix, sent in
   * place of the rejected changes. Saving a deleted Expense restores it. A new Expense on this
   * device starts in the currency of the one saved last (`lastCurrency`), Repayments aside.
   */
  async function saveExpense(
    tripId: string,
    expense: Expense,
    base: ExpenseBase,
  ): Promise<ExpenseProblem[]> {
    const problems = await queueExpense(tripId, expense, base, false);
    if (problems.length === 0 && !isRepayment(expense)) {
      await db.trips.update(tripId, { lastCurrency: expense.currency });
    }
    return problems;
  }

  /**
   * Deletes an Expense on this device, softly: it moves to Recently deleted, keeping its
   * state, and saving it again restores it. Otherwise like `saveExpense`.
   */
  function deleteExpense(
    tripId: string,
    expense: Expense,
    base: ExpenseBase,
  ): Promise<ExpenseProblem[]> {
    return queueExpense(tripId, expense, base, true);
  }

  async function queueExpense(
    tripId: string,
    expense: Expense,
    base: ExpenseBase,
    deleted: boolean,
  ): Promise<ExpenseProblem[]> {
    return db.transaction('rw', db.trips, db.outbox, async () => {
      const local = await readLocal(tripId);
      // A removed Participant still counts: the Expense brings them back.
      const participants = [...local.participants, ...local.removedParticipants];
      const problems = expenseProblems(expense, { ...local, participants });
      if (problems.length > 0) return problems;

      const entries = await expenseEntries(tripId, expense.id);
      const rejected = entries[0]?.held?.status === 'rejected' ? entries[0] : null;
      if (rejected) await db.outbox.bulkDelete(entries.map(({ seq }) => seq));
      await enqueue(tripId, {
        kind: 'expense',
        base: rejected ? rejected.change.base : resolveBase(local, expense.id, base),
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

  /**
   * Resolves an Expense's Conflict with this device's version: its changes go again on top
   * of the version the Conflict showed, on the next sync.
   */
  async function keepMine(tripId: string, expenseId: string): Promise<void> {
    await db.transaction('rw', db.outbox, async () => {
      const [first] = await expenseEntries(tripId, expenseId);
      if (first?.held?.status !== 'conflict') return;
      const base = { version: first.held.current.version };
      await db.outbox.update(first.seq, { change: { ...first.change, base }, held: null });
    });
  }

  /**
   * Drops every change of an Expense this device has not synced: "keep theirs" for a
   * Conflict, whose version shows at once, or "discard" for a rejected change.
   */
  async function discardChanges(tripId: string, expenseId: string): Promise<void> {
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
  }

  /** The Trip as this device keeps it, for a call to the server; rejects if it is not here. */
  async function tripOnDevice(tripId: string): Promise<DeviceTrip> {
    const device = await db.trips.get(tripId);
    if (!device) throw new Error(`Trip ${tripId} is not on this device`);
    return device;
  }

  /** An Expense's Revisions from the server, newest first. Rejects without a connection. */
  async function revisions(tripId: string, expenseId: string): Promise<Revision[]> {
    const device = await tripOnDevice(tripId);
    return transport.revisions(tripId, device.token, expenseId);
  }

  /** Whom a Reminder can reach in the Trip, and who was reminded today. Rejects offline. */
  async function reminderStatus(tripId: string): Promise<ReminderStatus> {
    const device = await tripOnDevice(tripId);
    return transport.reminderStatus(tripId, device.token);
  }

  /**
   * Reminds `to` of the Suggested Repayment they owe this device's Claim (#42): a call of its
   * own, never queued. Rejects offline, as the creditor then shares a message instead.
   */
  async function remind(tripId: string, to: string): Promise<Reminded> {
    const device = await tripOnDevice(tripId);
    if (!device.claim) return 'notSuggested';
    return transport.remind(tripId, device.token, { from: device.claim.id, to });
  }

  /**
   * Pushes the Trip's outbox and pulls the Trip. Calls for a Trip already syncing run once
   * more after it. Never rejects: whatever doesn't get through waits for the next sync.
   */
  function sync(tripId: string): Promise<void> {
    const inFlight = running.get(tripId);
    if (inFlight) {
      again.add(tripId);
      return inFlight;
    }
    const run = (async () => {
      do {
        again.delete(tripId);
        await syncOnce(tripId).catch(() => {});
      } while (again.has(tripId));
    })().finally(() => running.delete(tripId));
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
    const { trip: snapshot } = pulled;
    const rates = cachedRates(device.rates, pulled.rates);
    if (snapshot) {
      await db.transaction('rw', db.trips, db.outbox, async () => {
        await db.trips.update(tripId, { snapshot, rates });
        await dropRemovedClaim(tripId);
      });
    } else {
      await db.trips.update(tripId, { rates });
    }
    await syncSubscription(tripId);
  }

  /**
   * Gives the server the push subscription the Trip should have on this device, if it has
   * not got it: the browser's, for the device's Claim, while notifications are on and the
   * device has a Claim; otherwise none. Sent again once per run of the app, as the server
   * drops a subscription whose push service says it is gone. A subscription left from when the
   * Trip was forgotten goes first, so it can't remove the new one later.
   */
  async function syncSubscription(tripId: string): Promise<void> {
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
    await setNotifications(tripId, { registered: wanted });
  }

  async function removeForgotten({ tripId, token }: ForgottenTrip): Promise<void> {
    await transport.unsubscribe(tripId, token, deviceId);
    await db.forgotten.delete(tripId);
  }

  /**
   * Removes the push subscriptions of Trips forgotten on this device that the server may
   * still have. Never rejects: whatever doesn't get through waits for the next time.
   */
  async function syncForgotten(): Promise<void> {
    for (const forgotten of await db.forgotten.toArray()) {
      await removeForgotten(forgotten).catch(() => {});
    }
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
    const snapshot = (await db.trips.get(tripId))?.snapshot;
    const pulled = new Map(snapshot?.expenses.map(({ id, version }) => [id, version]));
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

    const known = [...(snapshot?.participants ?? []), ...(snapshot?.removedParticipants ?? [])];
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
   * Takes an accepted change out of the outbox into the snapshot. The Expense's next change
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
    forgetTrip,
    open,
    claim,
    turnOnNotifications,
    turnOffNotifications,
    declineNotifications,
    renewSubscription,
    addParticipant,
    removeParticipant,
    saveTripDetails,
    dismissNotice,
    saveExpense,
    deleteExpense,
    keepMine,
    discardChanges,
    revisions,
    reminderStatus,
    remind,
    sync,
    syncForgotten,
  };
}

export type Device = ReturnType<typeof createDevice>;

/**
 * The device's cached rate entries with those a pull brought: each of those replaces the one
 * for its date and pair, and the rest stay, so a pair the Trip no longer needs keeps its latest
 * cached rate for a Provisional rate later, e.g. offline.
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
 * Expense brought back (named as `known` has them), or a removal the server refused.
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
  if (change.kind === 'participant' && result.problems.includes('participantReferenced')) {
    return [{ kind: 'removalRefused', participant: change.participant }];
  }
  return [];
}
