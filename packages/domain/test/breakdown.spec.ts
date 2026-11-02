import { describe, expect, it } from 'vite-plus/test';
import {
  balances,
  rational,
  shareBreakdown,
  shareBreakdowns,
  type Expense,
} from '@osi/owe-yeah-domain';

const rafal = '019a2b3c-4d5e-7f00-8a1b-000000000001';
const ania = '019a2b3c-4d5e-7f00-8a1b-000000000002';
const kuba = '019a2b3c-4d5e-7f00-8a1b-000000000003';
const ola = '019a2b3c-4d5e-7f00-8a1b-000000000004';

type LineItem = Extract<Expense, { lineItems: unknown }>['lineItems'][number];

/** A Receipt paid by Rafał with these Line items, in EUR. */
function receipt(...lineItems: LineItem[]): Extract<Expense, { lineItems: unknown }> {
  return {
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
    title: 'Lidl Rovinj',
    currency: 'EUR',
    time: { instant: '2026-07-14T09:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: rafal,
    lineItems,
  };
}

const beerSplit = {
  mode: 'units' as const,
  parts: [
    { participantId: rafal, units: 2 },
    { participantId: ania, units: 2 },
    { participantId: kuba, units: 1 },
  ],
};

const cents = (amount: bigint) => rational(amount, 100n);

describe('shareBreakdown of a Receipt', () => {
  it('shows each share as the goods at full price less the Line discount', () => {
    // The worked example: 5 × 2.00, 1.00 off, Units 2/2/1 gives 3.60 / 3.60 / 1.80.
    const beer = receipt({
      name: 'Beer',
      unitPrice: 200,
      quantity: 5,
      discount: { kind: 'amount', amount: 100 },
      split: beerSplit,
    });

    const breakdown = shareBreakdown(beer);

    expect(breakdown.get(ania)).toEqual({
      share: cents(360n),
      parts: [
        { part: 'goods', amount: cents(400n) },
        { part: 'lineDiscounts', amount: cents(-40n) },
      ],
    });
    expect(breakdown.get(kuba)?.share).toEqual(cents(180n));
  });

  it('shows Deposits, Deposit refunds and the Receipt discount, never discounting the first two', () => {
    const shopping = {
      ...receipt(
        {
          name: 'Water',
          unitPrice: 100,
          quantity: 2,
          depositPerUnit: 25,
          split: { mode: 'even', participantIds: [rafal, ania] },
        },
        {
          name: 'Bread',
          unitPrice: 300,
          quantity: 1,
          split: { mode: 'even', participantIds: [ania, kuba] },
        },
        {
          name: '',
          unitPrice: -60,
          quantity: 1,
          split: { mode: 'even', participantIds: [rafal, ania, kuba] },
        },
      ),
      discount: { kind: 'percent' as const, basisPoints: 1000 },
    };

    const breakdown = shareBreakdown(shopping);

    expect(breakdown.get(ania)).toEqual({
      share: cents(230n),
      parts: [
        { part: 'goods', amount: cents(250n) },
        { part: 'deposits', amount: cents(25n) },
        { part: 'depositRefunds', amount: cents(-20n) },
        { part: 'receiptDiscounts', amount: cents(-25n) },
      ],
    });
    expect(breakdown.get(kuba)?.share).toEqual(cents(115n));
  });

  it('shows the value not assigned yet as part of the Main payer’s share', () => {
    const incomplete = receipt(
      { name: 'Chips', unitPrice: 200, quantity: 1, split: { mode: 'even', participantIds: [] } },
      { name: 'Gum', unitPrice: 50, quantity: 1, split: { mode: 'even', participantIds: [rafal] } },
      {
        name: 'Cola',
        unitPrice: 100,
        quantity: 1,
        split: { mode: 'even', participantIds: [ania] },
      },
    );

    const breakdown = shareBreakdown(incomplete);

    expect(breakdown.get(rafal)).toEqual({
      share: cents(250n),
      parts: [
        { part: 'goods', amount: cents(50n) },
        { part: 'unassigned', amount: cents(200n) },
      ],
    });
    expect(breakdown.get(ania)?.parts).toEqual([{ part: 'goods', amount: cents(100n) }]);
  });
});

describe('shareBreakdowns of a Trip', () => {
  const plain = (id: string, mainPayerId: string, unitPrice: number): Expense => ({
    ...receipt({
      name: '',
      unitPrice,
      quantity: 1,
      split: { mode: 'even', participantIds: [rafal, ania, kuba] },
    }),
    id,
    mainPayerId,
  });
  const trip = {
    currency: 'EUR' as const,
    participants: [rafal, ania, kuba, ola].map((id) => ({ id, name: id })),
    rates: [],
    expenses: [
      plain('019a2b3c-4d5e-7f00-8a1b-0000000000e2', rafal, 6000),
      // Income Ania received for everyone.
      plain('019a2b3c-4d5e-7f00-8a1b-0000000000e3', ania, -3000),
      {
        id: '019a2b3c-4d5e-7f00-8a1b-0000000000e4',
        title: 'Repayment',
        currency: 'EUR' as const,
        time: { instant: '2026-07-15T09:30:00Z', zone: 'Europe/Zagreb' },
        mainPayerId: kuba,
        recipientId: ania,
        amount: 500,
      },
      receipt({
        name: 'Beer',
        unitPrice: 200,
        quantity: 5,
        discount: { kind: 'amount', amount: 100 },
        split: beerSplit,
      }),
    ],
  };

  it('adds up every Participant’s parts across the Trip, plain Expenses, Income and Repayments included', () => {
    const breakdowns = shareBreakdowns(trip);

    expect(breakdowns.get(ania)).toEqual({
      share: cents(1860n),
      parts: [
        { part: 'expenses', amount: cents(2000n) },
        { part: 'goods', amount: cents(400n) },
        { part: 'lineDiscounts', amount: cents(-40n) },
        { part: 'income', amount: cents(-1000n) },
        { part: 'repayments', amount: cents(500n) },
      ],
    });
  });

  it('adds up to the share each balance works with', () => {
    const breakdowns = shareBreakdowns(trip);

    for (const { participantId, share } of balances(trip)) {
      expect(breakdowns.get(participantId)?.share).toEqual(share);
    }
  });

  it('lists every Participant in the Trip’s order, with nothing for one who had nothing', () => {
    const breakdowns = shareBreakdowns(trip);

    expect([...breakdowns.keys()]).toEqual([rafal, ania, kuba, ola]);
    expect(breakdowns.get(ola)).toEqual({ share: rational(0n), parts: [] });
  });
});
