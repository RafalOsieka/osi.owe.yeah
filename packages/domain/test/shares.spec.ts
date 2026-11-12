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
    lineItems: [{ name: '', unitPrice, quantity: 1, split: { mode: 'even', participantIds } }],
  };
}

function repayment(mainPayerId: string, recipientId: string, amount: number): Expense {
  return {
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e2',
    title: 'Repayment',
    currency: 'EUR',
    time: { instant: '2026-06-13T09:00:00Z', zone: 'Europe/Zagreb' },
    mainPayerId,
    recipientId,
    amount,
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

  it('gives Income a negative total and negative shares', () => {
    // 4.80 EUR of Deposit refund received by Kasia, for Kasia and Ania.
    const { total, shares } = expenseShares(expense(kasia, -480, [kasia, ania]));

    expect(total).toEqual(rational(-24n, 5n));
    expect([...shares]).toEqual([
      [kasia, rational(-12n, 5n)],
      [ania, rational(-12n, 5n)],
    ]);
  });

  it('puts the whole of a Repayment on its recipient', () => {
    const { total, shares } = expenseShares(repayment(ania, kasia, 1260));

    expect(total).toEqual(rational(63n, 5n));
    expect([...shares]).toEqual([[kasia, rational(63n, 5n)]]);
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

  it("shows the others' part of an Income you received for them too as what you owe", () => {
    const income = expense(kasia, -900, [kasia, ania, ola]);

    expect(claimView(income, kasia)).toEqual({ kind: 'owe', amount: rational(6n) });
    expect(claimView(income, ania)).toEqual({ kind: 'getBack', amount: rational(3n) });
  });

  it('shows the whole of an Income you received only for others as what you owe', () => {
    expect(claimView(expense(kasia, -900, [ania, ola]), kasia)).toEqual({
      kind: 'owe',
      amount: rational(9n),
    });
  });

  it('shows the whole of an Income you received for yourself only as received', () => {
    expect(claimView(expense(kasia, -900, [kasia]), kasia)).toEqual({
      kind: 'received',
      amount: rational(9n),
    });
  });

  it("shows the others' part of a Receipt whose Deposit refunds outweigh its goods as what you owe", () => {
    // 3.00 of water and a 12.00 bottle voucher, both for all three, paid by Kasia: -9.00.
    const returns: Expense = {
      ...expense(kasia, 300, [kasia, ania, ola]),
      lineItems: [
        {
          name: 'Water',
          unitPrice: 300,
          quantity: 1,
          split: { mode: 'even', participantIds: [kasia, ania, ola] },
        },
        {
          name: 'Bottle voucher',
          unitPrice: -1200,
          quantity: 1,
          split: { mode: 'even', participantIds: [kasia, ania, ola] },
        },
      ],
    };

    expect(claimView(returns, kasia)).toEqual({ kind: 'owe', amount: rational(6n) });
  });

  it('shows a part of a Deposit refund as money you get back, whoever paid', () => {
    // Kasia's own 10.00 of beer, less a 0.90 bottle voucher shared Even by all three.
    const shop: Expense = {
      ...expense(kasia, 1000, [kasia]),
      lineItems: [
        {
          name: 'Beer',
          unitPrice: 1000,
          quantity: 1,
          split: { mode: 'even', participantIds: [kasia] },
        },
        {
          name: 'Bottle voucher',
          unitPrice: -90,
          quantity: 1,
          split: { mode: 'even', participantIds: [kasia, ania, ola] },
        },
      ],
    };

    expect(claimView(shop, ania)).toEqual({ kind: 'getBack', amount: rational(3n, 10n) });
    // She paid 9.10 and bears 9.70: below her Share, so it shows her whole Share.
    expect(claimView(shop, kasia)).toEqual({ kind: 'share', amount: rational(97n, 10n) });
  });

  it('shows a Repayment as paid by its payer and received by its recipient, and nobody else', () => {
    const paid = repayment(ania, kasia, 1260);

    expect(claimView(paid, ania)).toEqual({ kind: 'repaid', amount: rational(63n, 5n) });
    expect(claimView(paid, kasia)).toEqual({ kind: 'received', amount: rational(63n, 5n) });
    expect(claimView(paid, ola)).toEqual({ kind: 'notForYou' });
  });
});
