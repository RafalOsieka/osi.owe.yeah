import type { Expense, TripSnapshot } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import type { Held, OutboxEntry, QueuedChange } from '../../app/sync/db';
import { localTrip } from '../../app/sync/local-trip';

const tripId = '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b';
const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };
const meta = { claimId: null, deviceId: '0b6e8f3a-2c1d-4e5f-8a9b-1c2d3e4f5a6b' };

function expense(id: string, title: string): Expense {
  return {
    id,
    title,
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: kasia.id,
    lineItems: [{ unitPrice: 2450, split: { mode: 'even', participantIds: [kasia.id] } }],
  };
}

const lidl = expense('019a2b3c-4d5e-7f00-8a1b-200000000001', 'Lidl Rovinj');
const ferry = expense('019a2b3c-4d5e-7f00-8a1b-200000000002', 'Ferry');

const pulled: TripSnapshot = {
  id: tripId,
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia],
  version: 7,
  expenses: [
    { ...lidl, version: 3 },
    { ...ferry, version: 1 },
  ],
};

// Outbox entries in the order they are made, as IndexedDB numbers them.
let seq = 0;
function entry(change: QueuedChange, held: OutboxEntry['held'] = null): OutboxEntry {
  return { seq: ++seq, tripId, change, held };
}

describe('localTrip', () => {
  it('shows pending changes on top of the pulled Trip, and bases a new edit on them', () => {
    const edit = {
      ...meta,
      id: '019a2b3c-4d5e-7f00-8a1b-100000000001',
      kind: 'expense',
      base: { version: 3 },
      expense: { ...lidl, title: 'Konzum' },
    } as const;
    const added = {
      ...meta,
      id: '019a2b3c-4d5e-7f00-8a1b-100000000002',
      kind: 'participant',
      participant: ania,
    } as const;

    const trip = localTrip(pulled, [entry(edit), entry(added)]);

    expect(trip?.participants).toEqual([kasia, ania]);
    expect(trip?.expenses).toEqual([
      { ...lidl, title: 'Konzum', base: { after: edit.id }, unsynced: { status: 'pending' } },
      { ...ferry, base: { version: 1 }, unsynced: null },
    ]);
  });

  it('marks an Expense whose change the server holds back with why', () => {
    const refused = {
      ...meta,
      id: '019a2b3c-4d5e-7f00-8a1b-100000000003',
      kind: 'expense',
      base: { version: null },
      expense: expense('019a2b3c-4d5e-7f00-8a1b-200000000003', 'Pizza'),
    } as const;
    const held: Held = {
      changeId: refused.id,
      status: 'rejected',
      problems: ['unknownMainPayer'],
    };

    const trip = localTrip(pulled, [entry(refused, held)]);

    expect(trip?.expenses.at(-1)).toMatchObject({ title: 'Pizza', unsynced: held });
  });

  it('shows a Trip created on this device before the server has it', () => {
    const created = {
      ...meta,
      id: '019a2b3c-4d5e-7f00-8a1b-100000000004',
      kind: 'trip',
      trip: { name: 'Mazury 2026', currency: 'PLN' },
    } as const;
    const first = {
      ...meta,
      id: '019a2b3c-4d5e-7f00-8a1b-100000000005',
      kind: 'participant',
      participant: kasia,
    } as const;

    expect(localTrip(null, [entry(created), entry(first)])).toEqual({
      id: tripId,
      name: 'Mazury 2026',
      currency: 'PLN',
      participants: [kasia],
      expenses: [],
    });
  });

  it('has no Trip to show before the first pull of a joined Trip', () => {
    expect(localTrip(null, [])).toBeNull();
  });
});
