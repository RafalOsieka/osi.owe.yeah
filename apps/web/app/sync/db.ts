import {
  participantSchema,
  tripIdSchema,
  type ChangeResult,
  type ExpenseChange,
  type Participant,
  type SyncChange,
  type TripSnapshot,
} from '@osi/owe-yeah-domain';
import { Dexie, type EntityTable } from 'dexie';
import { z } from 'zod';

/**
 * A Trip opened on this device: how it reopens the Trip link, who the device says it is
 * there, and the Trip as the server last answered it.
 */
export type DeviceTrip = {
  id: string;
  /** The Trip link's token, the only credential (ADR 0001). */
  token: string;
  /** The Participant this device says it is in the Trip. Grants no rights. */
  claim: Participant | null;
  /** ISO time of the last open, for My Trips' order. */
  openedAt: string;
  /**
   * The Trip as last pulled, with the changes the server has accepted since applied on top;
   * `null` until the first pull, or the first push of a Trip created on this device.
   */
  snapshot: TripSnapshot | null;
};

/**
 * What an Expense change is based on: a version the server gave the Expense (`null` for a
 * new Expense), or an earlier change of the same Expense still in the outbox, whose version
 * it takes once the server accepts that one.
 */
export type ExpenseBase = { version: number | null } | { after: string };

/** A change as the outbox keeps it: an Expense change's base may still be waiting. */
export type QueuedChange =
  | Exclude<SyncChange, ExpenseChange>
  | (Omit<ExpenseChange, 'baseVersion'> & { base: ExpenseBase });

/** Why the server would not take an Expense change: it waits until someone deals with it. */
export type Held = Exclude<ChangeResult, { status: 'accepted' }>;

/** A change made on this device that the server has not accepted yet. */
export type OutboxEntry = {
  /** Order of the outbox, given by IndexedDB: changes are sent in it. */
  seq: number;
  tripId: string;
  change: QueuedChange;
  /** Set when the server answered a Conflict or a rejection; the change is not sent again. */
  held: Held | null;
};

/**
 * The device store (Dexie on IndexedDB). Each schema change is a new `version()` with an
 * `upgrade()` that migrates local data and queued changes; the chain is kept forever, as a
 * device may come back after any number of releases (ADR 0002).
 */
export class DeviceDb extends Dexie {
  trips!: EntityTable<DeviceTrip, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;

  constructor(name = 'owe-yeah') {
    super(name);
    this.version(1).stores({ trips: 'id', outbox: '++seq, tripId' });
    this.on('populate', (tx) => tx.table('trips').bulkAdd(tripsFromLocalStorage()));
  }
}

const LEGACY_KEY = 'owe-yeah:trips';

// What the device kept in localStorage before this store existed.
const legacyTripSchema = z.object({
  id: tripIdSchema,
  token: z.string().min(1),
  claim: participantSchema.nullable(),
  openedAt: z.string(),
});

/**
 * Trips opened before the device store existed, moved over once when the store is created.
 * They have no snapshot until their first pull. Anything unreadable is dropped.
 */
function tripsFromLocalStorage(): DeviceTrip[] {
  try {
    const legacy = z.array(z.unknown()).parse(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]'));
    return legacy.flatMap((entry) => {
      const trip = legacyTripSchema.safeParse(entry);
      return trip.success ? [{ ...trip.data, snapshot: null }] : [];
    });
  } catch {
    return [];
  }
}
