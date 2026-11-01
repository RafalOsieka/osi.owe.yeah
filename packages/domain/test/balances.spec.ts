import { describe, expect, it } from 'vite-plus/test';
import {
  balances,
  rational,
  roundMoney,
  type StoredExpense,
  type TripSnapshot,
} from '@osi/owe-yeah-domain';

const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };
const ola = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Ola' };

function expense(id: string, mainPayerId: string, unitPrice: number, participantIds: string[]) {
  return {
    id,
    title: 'Expense',
    currency: 'EUR',
    time: { instant: '2026-07-14T10:00:00Z', zone: 'Europe/Zagreb' },
    mainPayerId,
    lineItems: [{ unitPrice, split: { mode: 'even', participantIds } }],
    version: 1,
    deleted: false,
    edited: null,
  } satisfies StoredExpense;
}

const trip: TripSnapshot = {
  id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia, ania, ola],
  version: 1,
  expenses: [],
};

describe('balances', () => {
  it('gives every Participant zeros in a Trip without Expenses', () => {
    const zero = rational(0n);
    expect(balances(trip)).toEqual(
      [kasia, ania, ola].map(({ id }) => ({
        participantId: id,
        paid: zero,
        share: zero,
        balance: zero,
      })),
    );
  });

  it('splits evenly between ticked Participants, exactly, and credits the Main payer', () => {
    const snapshot: TripSnapshot = {
      ...trip,
      expenses: [
        // 10.00 EUR for three: 10/3 each, which no cent amount matches.
        expense('019a2b3c-4d5e-7f00-8a1b-0000000000e1', kasia.id, 1000, [
          kasia.id,
          ania.id,
          ola.id,
        ]),
        // 4.50 EUR for Ania and Ola, paid by Ania.
        expense('019a2b3c-4d5e-7f00-8a1b-0000000000e2', ania.id, 450, [ania.id, ola.id]),
      ],
    };

    expect(balances(snapshot)).toEqual([
      {
        participantId: kasia.id,
        paid: rational(10n),
        share: rational(10n, 3n),
        balance: rational(20n, 3n),
      },
      {
        participantId: ania.id,
        paid: rational(9n, 2n),
        share: rational(67n, 12n),
        balance: rational(-13n, 12n),
      },
      {
        participantId: ola.id,
        paid: rational(0n),
        share: rational(67n, 12n),
        balance: rational(-67n, 12n),
      },
    ]);
  });
});

describe('roundMoney', () => {
  it.each([
    [rational(9n, 4n), 'EUR', '2.25', true],
    [rational(10n, 3n), 'EUR', '3.33', false],
    [rational(-10n, 3n), 'EUR', '-3.33', false],
    [rational(1n, 200n), 'EUR', '0.01', false],
    [rational(-1n, 200n), 'EUR', '-0.01', false],
    [rational(-1n, 1000n), 'EUR', '0.00', false],
    [rational(1000n, 3n), 'JPY', '333', false],
    [rational(1n, 3n), 'KWD', '0.333', false],
    [rational(12n), 'EUR', '12.00', true],
  ])('rounds %o in %s to %s (exact: %s)', (amount, currency, decimal, exact) => {
    expect(roundMoney(amount, currency)).toEqual({ decimal, exact });
  });
});
