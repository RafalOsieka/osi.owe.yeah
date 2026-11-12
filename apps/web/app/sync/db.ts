import {
  expenseChangeSchema,
  expenseVersionSchema,
  participantChangeSchema,
  participantSchema,
  tripChangeSchema,
  tripIdSchema,
  type ChangeResult,
  type Currency,
  type Participant,
  type ParticipantChange,
  type RateEntry,
  type SubscriptionRequest,
  type TripChange,
  type TripCurrency,
  type TripSnapshot,
} from '@osi/owe-yeah-domain';
import { Dexie, type EntityTable } from 'dexie';
import { z } from 'zod';
import { migrations } from './migrations';

/**
 * Something sync did to this device's changes that the user should hear about, kept until
 * they dismiss it: a removed Participant an Expense of theirs brought back, a removal the
 * server refused, a new Trip currency it refused because the Trip has a Repayment now, their
 * Claim's Participant removed by someone else, a change of the Trip details or of a
 * Participant the server couldn't read and that is lost (`about` says what it changed), or a
 * Participant it refused because the Trip has as many as it can have.
 */
export type Notice = { id: string } & (
  | { kind: 'participantRestored'; participant: Participant; expenseTitle: string }
  | { kind: 'removalRefused'; participant: Participant }
  | { kind: 'currencyChangeRefused'; currency: TripCurrency }
  | { kind: 'claimRemoved'; participant: Participant }
  | { kind: 'tooManyParticipants'; participant: Participant }
  | {
      kind: 'changeRefused';
      about: Pick<TripChange, 'kind' | 'trip'> | Pick<ParticipantChange, 'kind' | 'participant'>;
    }
);

/** The browser's push subscription: where the server sends to, and the keys it encrypts with. */
export type BrowserSubscription = Omit<SubscriptionRequest, 'claimId'>;

/**
 * Push notifications for one Trip on this device (#41). The server gets the device's
 * subscription on sync while the toggle is on and the device has a Claim, and loses it once
 * either is gone.
 */
export type DeviceNotifications = {
  /** The browser's push subscription while the toggle is on; `null` while it is off. */
  subscription: BrowserSubscription | null;
  /**
   * Whether the device was offered notifications after making a Claim, or turned them on or
   * off itself: from then on it is never offered them again by itself.
   */
  offered: boolean;
  /** The endpoint and Claim the server last took for this device; `null` when it has none. */
  registered: { endpoint: string; claimId: string } | null;
};

/** Push notifications as a Trip new on this device has them: off, never offered. */
export const NOTIFICATIONS_OFF: DeviceNotifications = {
  subscription: null,
  offered: false,
  registered: null,
};

/**
 * A Trip forgotten on this device whose push subscription the server may still have: kept,
 * with the token that removes it, until it is removed on a sync.
 */
export type ForgottenTrip = { tripId: string; token: string };

/**
 * A Trip opened on this device: how it reopens the Trip link, who the device says it is
 * there, the Trip as the server last answered it, its cached rate entries, the currency of
 * the last Expense saved here, what sync has to tell, and its push notifications.
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
  notifications: DeviceNotifications;
};

/**
 * What an Expense change is based on: a version the server gave the Expense (`null` for a
 * new Expense), or an earlier change of the same Expense still in the outbox, whose version
 * it takes once the server accepts that one.
 */
const expenseBaseSchema = z.union([
  z.object({ version: expenseVersionSchema.nullable() }),
  z.object({ after: z.uuid() }),
]);

export type ExpenseBase = z.infer<typeof expenseBaseSchema>;

/**
 * A change as the outbox keeps it: a sync change (`syncChangeSchema`), except that an Expense
 * change's base may still be waiting. A change is parsed with it as it is queued, so the
 * outbox keeps only changes the server can read, as the schema outputs them (names trimmed).
 */
export const queuedChangeSchema = z.discriminatedUnion('kind', [
  tripChangeSchema,
  participantChangeSchema,
  expenseChangeSchema.omit({ baseVersion: true }).extend({ base: expenseBaseSchema }),
]);

export type QueuedChange = z.infer<typeof queuedChangeSchema>;

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
 * chain (`migrations`) is a version after it, which adds the tables the link names and whose
 * `upgrade()` runs the link on every Trip and outbox entry. A device coming back after any
 * number of releases runs every link it missed, in order, and then sends its migrated outbox
 * (ADR 0002).
 */
export class DeviceDb extends Dexie {
  trips!: EntityTable<DeviceTrip, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  forgotten!: EntityTable<ForgottenTrip, 'tripId'>;

  constructor(name = 'owe-yeah') {
    super(name);
    this.version(1).stores({ trips: 'id', outbox: '++seq, tripId' });
    for (const [index, { trip, entry, tables = {} }] of migrations.entries()) {
      this.version(index + 2)
        .stores(tables)
        .upgrade(async (tx) => {
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
        ? [
            {
              ...trip.data,
              snapshot: null,
              rates: [],
              lastCurrency: null,
              notices: [],
              notifications: NOTIFICATIONS_OFF,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
