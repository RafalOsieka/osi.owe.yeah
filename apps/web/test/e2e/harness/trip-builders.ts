import { randomBytes } from 'node:crypto';
import type {
  Expense,
  ExpenseChange,
  Participant,
  ParticipantChange,
  StoredExpense,
  SyncChange,
  TripChange,
  TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { expect } from 'vitest';

// Trips, Expenses and sync changes as the test suites build them: the db, api and ui suites
// push them to the server, the device tests save them on a device. Pure, apart from fresh ids.

/** The device making every change built here, without a Claim unless given. */
export const deviceId = uuidv7();

/** A Trip link token, as the device creating the Trip generates it. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function participant(name: string): Participant {
  return { id: uuidv7(), name };
}

export function newTrip(
  name = 'Croatia 2026',
  participants: Participant[] = [],
): TripWithParticipants {
  return { id: uuidv7(), name, currency: 'EUR', participants };
}

export function tripChange(
  { name, currency }: Pick<TripWithParticipants, 'name' | 'currency'>,
  claimId: string | null = null,
): TripChange {
  return { id: uuidv7(), claimId, deviceId, kind: 'trip', trip: { name, currency } };
}

export function participantChange(changed: Participant, removed = false): ParticipantChange {
  return {
    id: uuidv7(),
    claimId: null,
    deviceId,
    kind: 'participant',
    participant: changed,
    removed,
  };
}

/** A change saving `expense` over its Revision `baseVersion`, or adding it without one. */
export function change(
  expense: Expense,
  baseVersion: number | null = null,
  claimId: string | null = null,
): ExpenseChange {
  return { id: uuidv7(), claimId, deviceId, kind: 'expense', baseVersion, expense, deleted: false };
}

/** A change deleting `expense`, its state kept as it was. */
export function deletion(
  expense: Expense,
  baseVersion: number,
  claimId: string | null = null,
): ExpenseChange {
  return { ...change(expense, baseVersion, claimId), deleted: true };
}

/** `expense` as the pull returns it at `version`, made by `by` at whatever time. */
export function stored(expense: Expense, version: number, by: string | null = null): StoredExpense {
  return { ...expense, version, deleted: false, edited: { by, at: expect.any(String) } };
}

/** The Trip's creation and its first Participants, as a device's outbox holds them. */
export function creation(trip: TripWithParticipants): SyncChange[] {
  return [tripChange(trip), ...trip.participants.map((added) => participantChange(added))];
}

/**
 * A plain Expense "Lidl Rovinj" of 24.50 EUR paid by `payer`, split evenly between `ticked`;
 * `title` and `unitPrice` (in minor units) replace those.
 */
export function plainExpense(
  payer: Participant,
  ticked: Participant[] = [payer],
  { title = 'Lidl Rovinj', unitPrice = 2450 }: { title?: string; unitPrice?: number } = {},
): Expense {
  return {
    id: uuidv7(),
    title,
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: payer.id,
    lineItems: [
      {
        name: '',
        unitPrice,
        quantity: 1,
        split: { mode: 'even', participantIds: ticked.map(({ id }) => id) },
      },
    ],
  };
}
