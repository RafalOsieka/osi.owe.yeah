import { fromAny } from '@total-typescript/shoehorn';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import type { DeviceTrip, OutboxEntry } from '../../app/sync/db';
import { toV2, toV3, toV4, toV5 } from '../../app/sync/migrations';

const tripId = uuidv7();
const meta = { claimId: null, deviceId: uuidv7() };
const ania = { id: uuidv7(), name: 'Ania' };

/** Lidl Rovinj as every version of the store keeps it, Line items aside. */
const lidl = {
  id: uuidv7(),
  title: 'Lidl Rovinj',
  currency: 'EUR',
  time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
  mainPayerId: uuidv7(),
  lineItems: [],
} as const;

// Each link is given data as the version before kept it, which today's types don't describe.
describe('the device store migration chain', () => {
  it('v2 keeps Expenses kept before deletes and Revisions as live, and pulls their Trip again', () => {
    const trip: DeviceTrip = fromAny({
      snapshot: { id: tripId, version: 7, expenses: [{ ...lidl, version: 2 }] },
    });
    const entry: OutboxEntry = fromAny({
      change: { ...meta, id: uuidv7(), kind: 'expense', base: { version: 2 }, expense: lidl },
      held: { changeId: uuidv7(), status: 'conflict', current: { ...lidl, version: 3 } },
    });

    expect(toV2.trip(trip).snapshot).toMatchObject({
      version: 0,
      expenses: [{ ...lidl, version: 2, deleted: false, edited: null }],
    });
    expect(toV2.entry(entry)).toMatchObject({
      change: { expense: lidl, deleted: false },
      held: { current: { ...lidl, version: 3, deleted: false, edited: null } },
    });
  });

  it('v3 reads Expenses kept before Receipts as one unnamed unit, in the Trip and the outbox', () => {
    const line = { unitPrice: 2450, split: { mode: 'even', participantIds: [] } };
    const before = { ...lidl, lineItems: [line] };
    const stored = { ...before, version: 2, deleted: false, edited: null };
    const change = { ...meta, id: uuidv7(), kind: 'expense', base: { version: 2 }, deleted: false };
    const trip: DeviceTrip = fromAny({ snapshot: { id: tripId, version: 7, expenses: [stored] } });
    const entry: OutboxEntry = fromAny({
      change: { ...change, expense: before },
      held: { changeId: change.id, status: 'conflict', current: stored, currentClaimId: null },
    });

    const migrated = { ...lidl, lineItems: [{ ...line, name: '', quantity: 1 }] };
    expect(toV3.trip(trip).snapshot?.expenses).toEqual([{ ...stored, ...migrated }]);
    const { change: changed, held } = toV3.entry(entry);
    expect(changed).toEqual({ ...change, expense: migrated });
    expect(held).toMatchObject({ current: { ...stored, ...migrated } });
  });

  it('v4 keeps Participants queued before removal as kept, and pulls their Trip again', () => {
    const snapshot = { id: tripId, participants: [ania], version: 7, expenses: [] };
    const change = { ...meta, id: uuidv7(), kind: 'participant', participant: ania };

    expect(toV4.trip(fromAny({ snapshot }))).toMatchObject({
      notices: [],
      snapshot: { ...snapshot, version: 0, edited: null, removedParticipants: [] },
    });
    expect(toV4.entry(fromAny({ change })).change).toEqual({ ...change, removed: false });
  });

  it('v5 sends again an Expense refused for not being in the Trip currency, and drops the notes of a refused Trip currency', () => {
    const removed = { id: uuidv7(), kind: 'removalRefused', participant: ania };
    const trip: DeviceTrip = fromAny({
      snapshot: null,
      notices: [removed, { id: uuidv7(), kind: 'currencyRefused', currency: 'PLN' }],
    });
    const rejected = (problems: string[]): OutboxEntry =>
      fromAny({
        change: { id: uuidv7(), kind: 'expense' },
        held: { changeId: uuidv7(), status: 'rejected', problems },
      });

    expect(toV5.trip(trip)).toMatchObject({ rates: [], lastCurrency: null, notices: [removed] });
    expect(toV5.entry(rejected(['currencyNotTripCurrency'])).held).toBeNull();
    expect(
      toV5.entry(rejected(['currencyNotTripCurrency', 'unknownMainPayer'])).held,
    ).toMatchObject({ problems: ['unknownMainPayer'] });
  });
});
