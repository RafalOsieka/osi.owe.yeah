import { describe, expect, it } from 'vite-plus/test';
import { balanceChanges, rational, type Expense } from '@osi/owe-yeah-domain';
import type { TripExpenses } from '../src/settle-up.ts';

const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };
const ola = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Ola' };

const trip: Omit<TripExpenses, 'expenses'> = {
  currency: 'EUR',
  participants: [kasia, ania, ola],
  rates: [],
};

/** A plain Expense of `unitPrice` minor units paid by `mainPayerId`, split evenly. */
function expense(mainPayerId: string, unitPrice: number, participantIds: string[]): Expense {
  return {
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
    title: 'Lidl Rovinj',
    currency: 'EUR',
    time: { instant: '2026-07-14T10:00:00Z', zone: 'Europe/Zagreb' },
    mainPayerId,
    lineItems: [{ name: '', unitPrice, quantity: 1, split: { mode: 'even', participantIds } }],
  };
}

describe('balanceChanges', () => {
  it('gives everyone a new Expense touches what they paid and their share of it', () => {
    // 30.00 EUR paid by Kasia, for Kasia and Ania; Ola is not in it.
    const added = expense(kasia.id, 3000, [kasia.id, ania.id]);

    expect(balanceChanges(trip, null, added)).toEqual([
      { participantId: kasia.id, paid: rational(30n), share: rational(15n) },
      { participantId: ania.id, paid: rational(0n), share: rational(15n) },
    ]);
  });

  it('leaves out whoever an edit does not change, and gives the others the difference', () => {
    // Ola joins: Kasia's and Ania's shares drop from 15 to 10, Ola's rises from 0 to 10.
    const before = expense(kasia.id, 3000, [kasia.id, ania.id]);
    const after = expense(kasia.id, 3000, [kasia.id, ania.id, ola.id]);

    expect(balanceChanges(trip, before, after)).toEqual([
      { participantId: kasia.id, paid: rational(0n), share: rational(-5n) },
      { participantId: ania.id, paid: rational(0n), share: rational(-5n) },
      { participantId: ola.id, paid: rational(0n), share: rational(10n) },
    ]);
  });

  it('takes back what a deleted Expense gave', () => {
    const deleted = expense(ania.id, 1000, [ola.id]);

    expect(balanceChanges(trip, deleted, null)).toEqual([
      { participantId: ania.id, paid: rational(-10n), share: rational(0n) },
      { participantId: ola.id, paid: rational(0n), share: rational(-10n) },
    ]);
  });

  it('affects nobody when an edit changes no money, e.g. only the title', () => {
    const before = expense(kasia.id, 3000, [kasia.id, ania.id]);

    expect(balanceChanges(trip, before, { ...before, title: 'Konzum' })).toEqual([]);
  });

  it('counts a Participant whose share and payment change by the same amount', () => {
    // Kasia paid 10.00 for herself, then 20.00 for herself: her balance stays 0.
    const before = expense(kasia.id, 1000, [kasia.id]);
    const after = expense(kasia.id, 2000, [kasia.id]);

    expect(balanceChanges(trip, before, after)).toEqual([
      { participantId: kasia.id, paid: rational(10n), share: rational(10n) },
    ]);
  });
});
