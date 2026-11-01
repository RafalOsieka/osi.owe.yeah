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
    lineItems: [{ name: '', unitPrice, quantity: 1, split: { mode: 'even', participantIds } }],
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
        rounded: zero,
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
        rounded: rational(667n, 100n),
      },
      {
        participantId: ania.id,
        paid: rational(9n, 2n),
        share: rational(67n, 12n),
        balance: rational(-13n, 12n),
        rounded: rational(-108n, 100n),
      },
      {
        participantId: ola.id,
        paid: rational(0n),
        share: rational(67n, 12n),
        balance: rational(-67n, 12n),
        rounded: rational(-559n, 100n),
      },
    ]);
  });
});

describe('rounded balances', () => {
  const rounded = (snapshot: TripSnapshot) =>
    balances(snapshot).map(({ rounded }) => roundMoney(rounded, 'EUR').decimal);

  it('add up to zero, the cent left over going to the lowest Participant id on a tie', () => {
    // 10.00 EUR for three: +6.666…, −3.333…, −3.333…, all with the same remainder. Ola,
    // with the highest id, comes first in the Trip but last on the tie.
    const snapshot = {
      ...trip,
      participants: [ola, kasia, ania],
      expenses: [
        expense('019a2b3c-4d5e-7f00-8a1b-0000000000e1', kasia.id, 1000, [
          kasia.id,
          ania.id,
          ola.id,
        ]),
      ],
    };

    expect(rounded(snapshot)).toEqual(['-3.34', '6.67', '-3.33']);
  });

  it('give the cent left over to the largest remainder before the lowest id', () => {
    // Ola pays 0.01 EUR for all three and 0.01 EUR for Kasia and Ania. In cents: Kasia and
    // Ania −5/6 each (remainder 1/6), Ola +5/3 (remainder 2/3); one cent is left over.
    const snapshot = {
      ...trip,
      expenses: [
        expense('019a2b3c-4d5e-7f00-8a1b-0000000000e1', ola.id, 1, [kasia.id, ania.id, ola.id]),
        expense('019a2b3c-4d5e-7f00-8a1b-0000000000e2', ola.id, 1, [kasia.id, ania.id]),
      ],
    };

    expect(rounded(snapshot)).toEqual(['-0.01', '-0.01', '0.02']);
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
