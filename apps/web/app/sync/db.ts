import {
  participantSchema,
  tripIdSchema,
  type ChangeResult,
  type Currency,
  type ExpenseChange,
  type Participant,
  type RateEntry,
  type SyncChange,
  type TripSnapshot,
} from '@osi/owe-yeah-domain';
import { Dexie, type EntityTable } from 'dexie';
import { z } from 'zod';
import { migrations } from './migrations';

/**
 * Something sync did to this device's changes that the user should hear about, kept until
 * they dismiss it: a removed Participant an Expense of theirs brought back, a removal the
 * server refused, or their Claim's Participant removed by someone else.
 */
export type Notice = { id: string } & (
  | { kind: 'participantRestored'; participant: Participant; expenseTitle: string }
  | { kind: 'removalRefused'; participant: Participant }
  | { kind: 'claimRemoved'; participant: Participant }
);

/**
 * A Trip opened on this device: how it reopens the Trip link, who the device says it is
 * there, the Trip as the server last answered it, its cached rate entries, the currency of
 * the last Expense saved here, and what sync has to tell.
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
  /**
   * Every rate entry pulled for the Trip, the newest of each (ADR 0003): this device's cached
   * rates, which convert the Trip's Expenses into the Trip currency, offline too.
   */
  rates: RateEntry[];
  /** The currency of the Expense last saved on this device, which a new Expense starts in. */
  lastCurrency: Currency | null;
  notices: Notice[];
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
 * The device store (Dexie on IndexedDB). Version 1 is the first; each link of the migration
 * chain (`migrations`) is a version after it, whose `upgrade()` runs the link on every Trip and
 * outbox entry. A device coming back after any number of releases runs every link it missed,
 * in order, and then sends its migrated outbox (ADR 0002).
 */
export class DeviceDb extends Dexie {
  trips!: EntityTable<DeviceTrip, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;

  constructor(name = 'owe-yeah') {
    super(name);
    this.version(1).stores({ trips: 'id', outbox: '++seq, tripId' });
    for (const [index, { trip, entry }] of migrations.entries()) {
      this.version(index + 2).upgrade(async (tx) => {
        await tx
          .table<DeviceTrip, string>('trips')
          .toCollection()
          .modify((kept, ref) => {
            ref.value = trip(kept);
          });
        await tx
          .table<OutboxEntry, number>('outbox')
          .toCollection()
          .modify((kept, ref) => {
            ref.value = entry(kept);
          });
      });
    }
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
      return trip.success
        ? [{ ...trip.data, snapshot: null, rates: [], lastCurrency: null, notices: [] }]
        : [];
    });
  } catch {
    return [];
  }
}
