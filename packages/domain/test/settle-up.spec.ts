import { describe, expect, it } from 'vite-plus/test';
import {
  isSettled,
  rational,
  spendingTotal,
  suggestedRepayments,
  type StoredExpense,
  type TripSnapshot,
} from '@osi/owe-yeah-domain';

const ania = '019a2b3c-4d5e-7f00-8a1b-000000000001';
const bartek = '019a2b3c-4d5e-7f00-8a1b-000000000002';
const kasia = '019a2b3c-4d5e-7f00-8a1b-000000000003';
const marek = '019a2b3c-4d5e-7f00-8a1b-000000000004';

/** Rounded balances in cents, by Participant. */
const rounded = (cents: Record<string, number>) =>
  Object.entries(cents).map(([participantId, amount]) => ({
    participantId,
    rounded: rational(BigInt(amount), 100n),
  }));

describe('suggestedRepayments', () => {
  it('pairs the biggest debtor with the biggest creditor, in at most n − 1 transfers', () => {
    const suggestions = suggestedRepayments(
      rounded({ [ania]: 8420, [bartek]: 1260, [kasia]: -4500, [marek]: -5180 }),
    );

    expect(suggestions).toEqual([
      { payerId: marek, recipientId: ania, amount: rational(5180n, 100n) },
      { payerId: kasia, recipientId: ania, amount: rational(3240n, 100n) },
      { payerId: kasia, recipientId: bartek, amount: rational(1260n, 100n) },
    ]);
  });

  it('settles equal debts in Participant id order, whatever order they come in', () => {
    const suggestions = suggestedRepayments(
      rounded({ [marek]: -500, [kasia]: -500, [ania]: 1000 }),
    );

    expect(suggestions).toEqual([
      { payerId: kasia, recipientId: ania, amount: rational(5n) },
      { payerId: marek, recipientId: ania, amount: rational(5n) },
    ]);
  });

  it('suggests nothing when every rounded balance is zero', () => {
    expect(suggestedRepayments(rounded({ [ania]: 0, [bartek]: 0 }))).toEqual([]);
  });
});

const trip: TripSnapshot = {
  id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [
    { id: ania, name: 'Ania' },
    { id: bartek, name: 'Bartek' },
  ],
  version: 1,
  expenses: [],
};

const stored = { version: 1, deleted: false, edited: null } as const;
const base = {
  currency: 'EUR',
  time: { instant: '2026-07-14T10:00:00Z', zone: 'Europe/Zagreb' },
  ...stored,
} as const;

/** `unitPrice` cents paid by `mainPayerId`, split evenly between everyone. */
const forBoth = (id: string, mainPayerId: string, unitPrice: number): StoredExpense => ({
  ...base,
  id,
  title: unitPrice < 0 ? 'Deposit refund' : 'Dinner',
  mainPayerId,
  lineItems: [{ unitPrice, split: { mode: 'even', participantIds: [ania, bartek] } }],
});

const repaid = (id: string, mainPayerId: string, recipientId: string, amount: number) => ({
  ...base,
  id,
  title: 'Repayment',
  mainPayerId,
  recipientId,
  amount,
});

describe('isSettled', () => {
  it('is settled once Repayments bring every rounded balance to zero', () => {
    // 10.01 EUR for two leaves Bartek owing 5.005, which rounds to 5.01 with nothing left.
    const dinner = forBoth('019a2b3c-4d5e-7f00-8a1b-0000000000e1', ania, 1001);
    expect(isSettled({ ...trip, expenses: [dinner] })).toBe(false);

    const repayment = repaid('019a2b3c-4d5e-7f00-8a1b-0000000000e2', bartek, ania, 501);
    expect(isSettled({ ...trip, expenses: [dinner, repayment] })).toBe(true);
  });

  it('is not settled before the Trip has any Expense', () => {
    expect(isSettled(trip)).toBe(false);
  });
});

describe('spendingTotal', () => {
  it('is net of Income and leaves Repayments out', () => {
    const expenses = [
      forBoth('019a2b3c-4d5e-7f00-8a1b-0000000000e1', ania, 6290),
      forBoth('019a2b3c-4d5e-7f00-8a1b-0000000000e2', bartek, -480),
      repaid('019a2b3c-4d5e-7f00-8a1b-0000000000e3', bartek, ania, 2905),
    ];

    expect(spendingTotal(expenses)).toEqual(rational(581n, 10n));
  });
});
