import { describe, expect, it } from 'vite-plus/test';
import {
  expenseProblems,
  expenseSchema,
  expenseTimeFromLocal,
  groupByLocalDay,
  localDateTime,
  localDay,
  type Expense,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';

const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };
const trip: TripWithParticipants = {
  id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia, ania],
};

const lidl: Expense = {
  id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
  title: 'Lidl Rovinj',
  currency: 'EUR',
  time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
  mainPayerId: kasia.id,
  lineItems: [
    {
      name: '',
      unitPrice: 2450,
      quantity: 1,
      split: { mode: 'even', participantIds: [kasia.id, ania.id] },
    },
  ],
};

const repayment: Expense = {
  id: '019a2b3c-4d5e-7f00-8a1b-0000000000e5',
  title: 'Repayment',
  currency: 'EUR',
  time: { instant: '2026-07-15T08:00:00Z', zone: 'Europe/Zagreb' },
  mainPayerId: ania.id,
  recipientId: kasia.id,
  amount: 1225,
};

describe('expenseSchema', () => {
  it('accepts a plain Expense and keeps its instant in UTC', () => {
    const sent = { ...lidl, time: { instant: '2026-07-14T23:30:00+02:00', zone: 'Europe/Zagreb' } };
    expect(expenseSchema.parse(sent)).toEqual(lidl);
  });

  it('accepts Income: a plain Expense whose amount is negative', () => {
    const refund: Expense = {
      ...lidl,
      lineItems: [{ ...lidl.lineItems[0]!, unitPrice: -480 }],
    };
    expect(expenseSchema.parse(refund)).toEqual(refund);
  });

  it('reads an Expense saved before Receipts as one unnamed unit', () => {
    const { name: _name, quantity: _quantity, ...saved } = lidl.lineItems[0]!;
    expect(expenseSchema.parse({ ...lidl, lineItems: [saved] })).toEqual(lidl);
  });

  it('keeps a Line discount and a Receipt discount as entered', () => {
    const discounted: Expense = {
      ...lidl,
      lineItems: [{ ...lidl.lineItems[0]!, discount: { kind: 'amount', amount: 100 } }],
      discount: { kind: 'percent', basisPoints: 1250 },
    };
    expect(expenseSchema.parse(discounted)).toEqual(discounted);
  });

  it('accepts a Repayment: one payer, one recipient and an amount, with no Line items', () => {
    expect(expenseSchema.parse(repayment)).toEqual(repayment);
  });

  it.each([
    ['a blank title', { ...lidl, title: '  ' }],
    ['an unknown time zone', { ...lidl, time: { ...lidl.time, zone: 'Mars/Olympus' } }],
    ['a time without an offset', { ...lidl, time: { ...lidl.time, instant: '2026-07-14T21:30' } }],
    ['no Line item', { ...lidl, lineItems: [] }],
    ['a fractional amount', { ...lidl, lineItems: [{ ...lidl.lineItems[0], unitPrice: 24.5 }] }],
    ['a zero amount', { ...lidl, lineItems: [{ ...lidl.lineItems[0], unitPrice: 0 }] }],
    ['a zero discount', { ...lidl, discount: { kind: 'amount', amount: 0 } }],
    ['a fractional percent', { ...lidl, discount: { kind: 'percent', basisPoints: 12.5 } }],
    ['a quantity of zero', { ...lidl, lineItems: [{ ...lidl.lineItems[0], quantity: 0 }] }],
    ['a fractional quantity', { ...lidl, lineItems: [{ ...lidl.lineItems[0], quantity: 1.5 }] }],
    [
      'a Participant ticked twice',
      {
        ...lidl,
        lineItems: [
          {
            name: '',
            unitPrice: 2450,
            quantity: 1,
            split: { mode: 'even', participantIds: [ania.id, ania.id] },
          },
        ],
      },
    ],
    ['a Repayment of nothing', { ...repayment, amount: 0 }],
    ['a Repayment without a recipient', { ...repayment, recipientId: undefined }],
  ])('rejects %s', (_, sent) => {
    expect(expenseSchema.safeParse(sent).success).toBe(false);
  });
});

describe('expenseProblems', () => {
  it('finds nothing wrong with an Expense that fits the Trip', () => {
    expect(expenseProblems(lidl, trip)).toEqual([]);
  });

  it('refuses a Main payer or a ticked Participant who is not in the Trip', () => {
    const stranger = '019a2b3c-4d5e-7f00-8a1b-000000000099';
    const expense: Expense = {
      ...lidl,
      mainPayerId: stranger,
      lineItems: [
        {
          name: '',
          unitPrice: 2450,
          quantity: 1,
          split: { mode: 'even', participantIds: [stranger] },
        },
      ],
    };
    expect(expenseProblems(expense, trip)).toEqual(['unknownMainPayer', 'unknownParticipant']);
  });

  it('refuses a Repayment to someone not in the Trip, or to its own payer', () => {
    const stranger = '019a2b3c-4d5e-7f00-8a1b-000000000099';
    expect(expenseProblems(repayment, trip)).toEqual([]);
    expect(expenseProblems({ ...repayment, recipientId: stranger }, trip)).toEqual([
      'unknownParticipant',
    ]);
    expect(expenseProblems({ ...repayment, recipientId: ania.id }, trip)).toEqual([
      'repaymentToSelf',
    ]);
  });

  it('refuses a currency other than the Trip currency', () => {
    expect(expenseProblems({ ...lidl, currency: 'HUF' }, trip)).toEqual([
      'currencyNotTripCurrency',
    ]);
  });
});

describe('Expense time', () => {
  it("reads the Expense's local day in its own zone, not the device's", () => {
    // 21:30 UTC is already the next day in Tokyo.
    expect(localDay(lidl.time)).toBe('2026-07-14');
    expect(localDay({ ...lidl.time, zone: 'Asia/Tokyo' })).toBe('2026-07-15');
  });

  it('groups Expenses by their own local day, newest first', () => {
    const at = (id: string, instant: string, zone: string): Expense => ({
      ...lidl,
      id,
      time: { instant, zone },
    });
    const lunch = at(
      '019a2b3c-4d5e-7f00-8a1b-0000000000e2',
      '2026-07-14T10:00:00Z',
      'Europe/Zagreb',
    );
    const dinner = at(
      '019a2b3c-4d5e-7f00-8a1b-0000000000e3',
      '2026-07-14T18:00:00.5Z',
      'Europe/Zagreb',
    );
    // Earlier than dinner in UTC, but already 15 July where it happened.
    const tokyo = at('019a2b3c-4d5e-7f00-8a1b-0000000000e4', '2026-07-14T16:00:00Z', 'Asia/Tokyo');

    expect(groupByLocalDay([lunch, tokyo, dinner])).toEqual([
      { day: '2026-07-15', expenses: [tokyo] },
      { day: '2026-07-14', expenses: [dinner, lunch] },
    ]);
  });

  it('turns a local date and time in a zone into a UTC instant, and back', () => {
    const time = expenseTimeFromLocal('2026-07-14T23:30', 'Europe/Zagreb');
    expect(time).toEqual(lidl.time);
    expect(localDateTime(time)).toBe('2026-07-14T23:30');
  });
});
