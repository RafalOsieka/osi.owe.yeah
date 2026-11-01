import {
  expenseProblems,
  type Expense,
  type ExpenseProblem,
  type Participant,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncChange,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import type { DeviceDb, DeviceTrip, ExpenseBase, OutboxEntry, QueuedChange } from './db';
import { localTrip, withAccepted, withExpense, type LocalTrip } from './local-trip';

/**
 * How the device reaches the sync API. Both calls reject when no answer comes back (e.g. no
 * signal); `pull` answers `invalidLink` when the server refuses the token.
 */
export type Transport = {
  push(tripId: string, token: string, request: PushRequest): Promise<PushResponse>;
  pull(tripId: string, token: string, since?: number): Promise<PullResponse | 'invalidLink'>;
};

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
        local: localTrip(deviceTrip.snapshot, entries),
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
      });
      await enqueue(id, { kind: 'trip', trip: { name, currency } });
      for (const participant of participants)
        await enqueue(id, { kind: 'participant', participant });
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
    const snapshot = pulled.trip;
    await db.transaction('rw', db.trips, async () => {
      const known = await db.trips.get(tripId);
      await db.trips.put({
        id: tripId,
        token,
        claim: known?.claim ?? null,
        openedAt: new Date().toISOString(),
        snapshot,
      });
    });
    return 'joined';
  }

  /** Records that a Trip on this device was opened now, for My Trips' order. */
  async function open(tripId: string): Promise<void> {
    await db.trips.update(tripId, { openedAt: new Date().toISOString() });
  }

  /** Sets which Participant this device is in a Trip. */
  async function claim(tripId: string, participant: Participant): Promise<void> {
    await db.trips.update(tripId, { claim: participant });
  }

  /** Adds or renames a Participant on this device; it reaches the server on sync. */
  async function addParticipant(tripId: string, participant: Participant): Promise<void> {
    await enqueue(tripId, { kind: 'participant', participant });
  }

  /**
   * Saves an Expense's full new state on this device, based on what the user edited (the
   * Expense's `base` as `read` showed it). Resolves to the Trip rules it breaks, in which case
   * nothing is saved; it reaches the server on sync. An Expense in Conflict keeps the edit on
   * this device's version; one with a rejected change takes the edit as its fix, sent in
   * place of the rejected changes.
   */
  async function saveExpense(
    tripId: string,
    expense: Expense,
    base: ExpenseBase,
  ): Promise<ExpenseProblem[]> {
    return db.transaction('rw', db.trips, db.outbox, async () => {
      const view = await read(tripId);
      if (!view?.local) throw new Error(`Trip ${tripId} is not on this device`);
      const problems = expenseProblems(expense, view.local);
      if (problems.length > 0) return problems;

      const entries = await expenseEntries(tripId, expense.id);
      const rejected = entries[0]?.held?.status === 'rejected' ? entries[0] : null;
      if (rejected) await db.outbox.bulkDelete(entries.map(({ seq }) => seq));
      await enqueue(tripId, {
        kind: 'expense',
        base: rejected ? rejected.change.base : resolveBase(view.local, expense.id, base),
        expense,
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
    const current = trip.expenses.find(({ id }) => id === expenseId)?.base ?? { version: null };
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

  async function syncOnce(tripId: string): Promise<void> {
    const device = await db.trips.get(tripId);
    if (!device) return;
    // An accepted change can free the next change of its Expense, so push until none is.
    while (await pushRound(device)) {
      /* keep pushing */
    }
    const pulled = await transport.pull(tripId, device.token, device.snapshot?.version);
    if (pulled === 'invalidLink' || !pulled.trip) return;
    const snapshot = pulled.trip;
    await db.trips.update(tripId, { snapshot });
  }

  /**
   * Sends every change that can go now: not held, and for an Expense, on a known base. One
   * Expense's changes go one per push, each on the version the last one got. Resolves to
   * whether anything was accepted.
   */
  async function pushRound({ id: tripId, token }: DeviceTrip): Promise<boolean> {
    const ready = (await entriesOf(tripId))
      .filter(
        ({ change, held }) => !held && (change.kind !== 'expense' || 'version' in change.base),
      )
      .slice(0, PUSH_LIMIT);
    if (ready.length === 0) return false;

    const { results } = await transport.push(tripId, token, {
      changes: ready.map(({ change }) => toSyncChange(change)),
    });

    let accepted = false;
    await db.transaction('rw', db.trips, db.outbox, async () => {
      for (const result of results) {
        const entry = ready.find(({ change }) => change.id === result.changeId);
        if (!entry) continue;
        if (result.status === 'accepted') {
          accepted = true;
          await accept(entry, result.version);
        } else if (entry.change.kind === 'expense') {
          await db.outbox.update(entry.seq, { held: result });
        } else {
          // A Participant id another Trip took: nothing anyone could fix.
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
    open,
    claim,
    addParticipant,
    saveExpense,
    keepMine,
    discardChanges,
    sync,
  };
}

export type Device = ReturnType<typeof createDevice>;

/** A queued change as the push sends it: an Expense change's base is known by now. */
function toSyncChange(change: QueuedChange): SyncChange {
  if (change.kind !== 'expense') return change;
  const { base, ...rest } = change;
  if (!('version' in base)) throw new Error(`Change ${change.id} is not ready to send`);
  return { ...rest, baseVersion: base.version };
}
