import { describe, expect, it } from 'vite-plus/test';
import { claimView, expenseShares, rational, type Expense } from '@osi/owe-yeah-domain';

const kasia = '019a2b3c-4d5e-7f00-8a1b-000000000001';
const ania = '019a2b3c-4d5e-7f00-8a1b-000000000002';
const ola = '019a2b3c-4d5e-7f00-8a1b-000000000003';

function expense(mainPayerId: string, unitPrice: number, participantIds: string[]): Expense {
  return {
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
    title: 'Fuel',
    currency: 'EUR',
    time: { instant: '2026-06-12T12:32:00Z', zone: 'Europe/Zagreb' },
    mainPayerId,
    lineItems: [{ unitPrice, split: { mode: 'even', participantIds } }],
  };
}

describe('expenseShares', () => {
  it('gives the total and an exact even share to each ticked Participant, in split order', () => {
    // 62.90 EUR for three: 62.9 / 3 = 629/30 each.
    const { total, shares } = expenseShares(expense(kasia, 6290, [ola, kasia, ania]));

    expect(total).toEqual(rational(629n, 10n));
    expect([...shares]).toEqual([
      [ola, rational(629n, 30n)],
      [kasia, rational(629n, 30n)],
      [ania, rational(629n, 30n)],
    ]);
  });

  it('leaves out Participants who are not ticked', () => {
    const { shares } = expenseShares(expense(kasia, 1000, [ania]));

    expect([...shares]).toEqual([[ania, rational(10n)]]);
  });
});

describe('claimView', () => {
  it('shows what you lent when you paid: the total less your own share', () => {
    // 62.90 EUR for Kasia, Ania and Ola, paid by Kasia: she lent 2/3 of it.
    expect(claimView(expense(kasia, 6290, [kasia, ania, ola]), kasia)).toEqual({
      kind: 'lent',
      amount: rational(629n, 15n),
    });
  });

  it('shows the whole total as lent when you paid only for others', () => {
    expect(claimView(expense(kasia, 1000, [ania, ola]), kasia)).toEqual({
      kind: 'lent',
      amount: rational(10n),
    });
  });

  it('shows your share when someone else paid for you', () => {
    expect(claimView(expense(kasia, 1000, [kasia, ania, ola]), ania)).toEqual({
      kind: 'share',
      amount: rational(10n, 3n),
    });
  });

  it('says it is not for you when someone else paid and you are not ticked', () => {
    expect(claimView(expense(kasia, 1000, [kasia, ola]), ania)).toEqual({ kind: 'notForYou' });
  });
});
