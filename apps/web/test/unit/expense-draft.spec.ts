import {
  rational,
  type Repayment,
  type SplitExpense,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import {
  chooseSplitMode,
  draftFromExpense,
  draftLineItem,
  itemise,
  newExpenseDraft,
  newRepaymentDraft,
  pickMainPayer,
  readDraft,
  readLineItem,
  type DraftLineItem,
  type DraftReason,
  type ExpenseDraft,
  type RepaymentDraft,
  type SplitDraft,
} from '../../app/utils/expense-draft';

const kasia = '019a2b3c-4d5e-7f00-8a1b-000000000001';
const ania = '019a2b3c-4d5e-7f00-8a1b-000000000002';
const ola = '019a2b3c-4d5e-7f00-8a1b-000000000003';

const trip: TripWithParticipants = {
  id: '019a2b3c-4d5e-7f00-8a1b-100000000001',
  name: 'Istria 2026',
  currency: 'EUR',
  participants: [
    { id: kasia, name: 'Kasia' },
    { id: ania, name: 'Ania' },
    { id: ola, name: 'Ola' },
  ],
};

const base = {
  id: '019a2b3c-4d5e-7f00-8a1b-200000000001',
  title: 'Lidl Rovinj',
  currency: 'EUR',
  time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
  mainPayerId: kasia,
} as const;

describe('an Expense made a draft reads back as the same Expense', () => {
  it('a plain Expense', () => {
    const expense: SplitExpense = {
      ...base,
      lineItems: [
        {
          name: '',
          unitPrice: 2450,
          quantity: 1,
          split: { mode: 'even', participantIds: [kasia, ola] },
        },
      ],
    };

    expect(readDraft(draftFromExpense(expense, trip), trip).expense).toEqual(expense);
  });

  it.each<[string, SplitExpense]>([
    [
      'Income',
      {
        ...base,
        lineItems: [
          { name: '', unitPrice: -600, quantity: 1, split: { mode: 'even', participantIds: [ania] } },
        ],
      },
    ],
    [
      'a Receipt with a Line discount, a Receipt discount, and every Split mode',
      {
        ...base,
        lineItems: [
          {
            name: 'Beer',
            unitPrice: 200,
            quantity: 5,
            discount: { kind: 'amount', amount: 100 },
            split: {
              mode: 'units',
              parts: [
                { participantId: kasia, units: 2 },
                { participantId: ola, units: 1 },
              ],
            },
          },
          {
            name: 'Pizza',
            unitPrice: 1250,
            quantity: 1,
            discount: { kind: 'percent', basisPoints: 1250 },
            split: {
              mode: 'amounts',
              parts: [
                { participantId: ania, amount: 700 },
                { participantId: kasia, amount: 5 },
              ],
            },
          },
          { name: 'Bread', unitPrice: 249, quantity: 1, split: { mode: 'even', participantIds: [] } },
        ],
        discount: { kind: 'percent', basisPoints: 1000 },
      },
    ],
    [
      'a Receipt with Deposits and a Deposit refund',
      {
        ...base,
        lineItems: [
          {
            name: 'Mineral water',
            unitPrice: 53,
            quantity: 10,
            depositPerUnit: 25,
            split: { mode: 'even', participantIds: [kasia, ania, ola] },
          },
          {
            name: '',
            unitPrice: -100,
            quantity: 1,
            split: { mode: 'even', participantIds: [kasia, ania, ola] },
          },
        ],
        discount: { kind: 'amount', amount: 50 },
      },
    ],
    [
      'Contributions',
      {
        ...base,
        lineItems: [
          { name: '', unitPrice: 6000, quantity: 1, split: { mode: 'even', participantIds: [kasia, ania] } },
        ],
        contributions: [
          { participantId: ola, amount: 600 },
          { participantId: ania, amount: 1 },
        ],
      },
    ],
    [
      'a Manual rate as a rate',
      {
        ...base,
        currency: 'USD',
        manualRate: { kind: 'rate', rate: '0.87593', currency: 'EUR' },
        lineItems: [
          { name: '', unitPrice: 2000, quantity: 1, split: { mode: 'even', participantIds: [ola] } },
        ],
      },
    ],
    [
      'a Manual rate as an amount charged, in a currency the Trip had before',
      {
        ...base,
        currency: 'HUF',
        manualRate: { kind: 'charged', amount: 4321, currency: 'PLN' },
        lineItems: [
          { name: '', unitPrice: 1500000, quantity: 1, split: { mode: 'even', participantIds: [ola] } },
        ],
      },
    ],
  ])('%s', (_, expense) => {
    expect(readDraft(draftFromExpense(expense, trip), trip).expense).toEqual(expense);
  });

  it('a Repayment', () => {
    const repayment: Repayment = {
      ...base,
      currency: 'CZK',
      manualRate: { kind: 'charged', amount: 4000, currency: 'EUR' },
      recipientId: ania,
      amount: 100000,
    };

    expect(readDraft(draftFromExpense(repayment, trip), trip).expense).toEqual(repayment);
  });
});

const start = {
  now: new Date('2026-07-14T21:30:00Z'),
  zone: 'Europe/Zagreb',
  claimId: kasia,
  lastCurrency: null,
};

/** A new plain Expense with a title and an amount, and `changes`. */
function plain(changes: Partial<SplitDraft> = {}): SplitDraft {
  return { ...newExpenseDraft(trip, start), title: 'Lidl Rovinj', amount: '10', ...changes };
}

/** A new Repayment of 10.00 from Kasia to Ania, and `changes`. */
function repayment(changes: Partial<RepaymentDraft> = {}): RepaymentDraft {
  return {
    ...newRepaymentDraft(trip, { ...start, title: 'Repayment' }),
    recipientId: ania,
    amount: '10',
    ...changes,
  };
}

/** A Receipt draft with `lines`, each 1.00 for Kasia unless typed otherwise. */
function receipt(...lines: Partial<DraftLineItem>[]): SplitDraft {
  return plain({
    lineItems: lines.map((line) =>
      draftLineItem({
        name: '',
        price: '1',
        quantity: 1,
        split: { mode: 'even', participantIds: [kasia] },
        ...line,
      }),
    ),
  });
}

describe('a new draft', () => {
  it('is an Expense now, in the zone of the device, paid by the Claim for everyone', () => {
    const { expense } = readDraft(plain(), trip);

    expect(expense).toMatchObject({
      currency: 'EUR',
      time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
      mainPayerId: kasia,
      lineItems: [{ unitPrice: 1000, split: { mode: 'even', participantIds: [kasia, ania, ola] } }],
    });
  });

  it('is in the currency of the Expense saved last on the device', () => {
    expect(newExpenseDraft(trip, { ...start, lastCurrency: 'HUF' }).currency).toBe('HUF');
  });

  it('is paid by the first Participant when the device has no Claim', () => {
    expect(newExpenseDraft(trip, { ...start, claimId: null }).mainPayerId).toBe(kasia);
    expect(newExpenseDraft({ ...trip, participants: [] }, start).mainPayerId).toBe('');
  });

  it('starts a Repayment from a Suggested Repayment, leaving out who is not in the Trip', () => {
    const draft = newRepaymentDraft(trip, {
      ...start,
      title: 'Repayment',
      suggested: { payerId: ola, recipientId: '019a2b3c-4d5e-7f00-8a1b-000000000009', amount: '14.00' },
    });

    expect(draft).toMatchObject({ mainPayerId: ola, recipientId: '', amount: '14.00' });
  });
});

describe('the reasons a draft is not an Expense yet', () => {
  it('name each field that is missing', () => {
    const { expense, reasons } = readDraft(
      plain({ title: ' ', amount: '', mainPayerId: '', participantIds: [], local: '' }),
      trip,
    );

    expect(expense).toBeNull();
    expect(reasons).toEqual([
      { field: 'amount', code: 'missing' },
      { field: 'participantIds', code: 'missing' },
      { field: 'title', code: 'missing' },
      { field: 'mainPayerId', code: 'missing' },
      { field: 'local', code: 'missing' },
    ]);
    expect(readDraft(repayment({ recipientId: '' }), trip).reasons).toEqual([
      { field: 'recipientId', code: 'missing' },
    ]);
    expect(readDraft(receipt(), trip).reasons).toEqual([{ field: 'lineItems', code: 'missing' }]);
  });

  it('name each field that cannot be read', () => {
    const { reasons } = readDraft(
      plain({
        title: 'x'.repeat(101),
        // More decimals than EUR has.
        amount: '10,001',
        currency: 'USD',
        manualRate: { kind: 'rate', value: '0', currency: 'EUR' },
        contributions: [{ participantId: ola, amount: 'one' }],
      }),
      trip,
    );

    expect(reasons).toEqual([
      { field: 'amount', code: 'unreadable' },
      { field: 'title', code: 'tooLong' },
      { field: 'manualRate', code: 'unreadable' },
      { field: 'contributions', code: 'unreadable' },
    ]);
    expect(readDraft(repayment({ amount: '-5' }), trip).reasons).toEqual([
      { field: 'amount', code: 'unreadable' },
    ]);
  });

  it('name each Line item that cannot be read, and the Receipt discount', () => {
    const draft = receipt({ price: '2,49' }, { price: '?' });
    draft.discount = { kind: 'percent', value: '0,001' };
    const [, unreadable] = draft.lineItems!;

    expect(readDraft(draft, trip).reasons).toEqual([
      { field: 'lineItems', code: 'unreadable', line: unreadable!.key },
      { field: 'discount', code: 'unreadable' },
    ]);
  });
});

describe('a Line item', () => {
  const line = (changes: Partial<DraftLineItem>) =>
    draftLineItem({
      name: ' Water ',
      price: ',29',
      quantity: 6,
      split: { mode: 'even', participantIds: [kasia] },
      ...changes,
    });

  it("reads as the Line item typed, an Amount left empty being nobody's yet", () => {
    const reading = readLineItem(
      line({
        deposit: '0,25',
        discount: { kind: 'amount', value: '0,40' },
        split: {
          mode: 'amounts',
          parts: [
            { participantId: kasia, amount: '1' },
            { participantId: ania, amount: ' ' },
          ],
        },
      }),
      'EUR',
    );

    expect(reading).toEqual({
      lineItem: {
        name: 'Water',
        unitPrice: 29,
        quantity: 6,
        discount: { kind: 'amount', amount: 40 },
        depositPerUnit: 25,
        split: { mode: 'amounts', parts: [{ participantId: kasia, amount: 100 }] },
      },
      reasons: [],
    });
  });

  it('says each part of it that cannot be read', () => {
    const reading = readLineItem(
      line({
        price: '0,291',
        discount: { kind: 'percent', value: 'ten' },
        deposit: '-1',
        split: { mode: 'amounts', parts: [{ participantId: kasia, amount: 'half' }] },
      }),
      'EUR',
    );

    expect(reading.reasons).toEqual([
      { field: 'price', code: 'unreadable' },
      { field: 'discount', code: 'unreadable' },
      { field: 'deposit', code: 'unreadable' },
      { field: 'amounts', code: 'unreadable' },
    ]);
  });

  it('is a Deposit refund of one negative unit, whatever else was typed for it', () => {
    const refund = line({
      refund: true,
      price: '1',
      deposit: 'x',
      discount: { kind: 'amount', value: 'y' },
    });

    expect(readLineItem(refund, 'EUR').lineItem).toEqual({
      name: 'Water',
      unitPrice: -100,
      quantity: 1,
      split: { mode: 'even', participantIds: [kasia] },
    });
    expect(readLineItem({ ...refund, price: '' }, 'EUR').reasons).toEqual([
      { field: 'amount', code: 'unreadable' },
    ]);
  });
});

describe('the Trip rules a draft would break', () => {
  it('show at their fields while the rest is still missing', () => {
    const { reasons } = readDraft(
      plain({ title: '', contributions: [{ participantId: ania, amount: '15' }] }),
      trip,
    );

    expect(reasons).toEqual([
      { field: 'title', code: 'missing' },
      { field: 'contributions', code: 'contributionsExceedTotal' },
    ]);
  });

  const usd = (draft: SplitDraft): SplitDraft => ({
    ...draft,
    currency: 'USD',
    manualRate: { kind: 'charged', value: '5', currency: 'EUR' },
  });

  it.each<[string, ExpenseDraft, DraftReason[]]>([
    [
      'a Repayment to oneself',
      repayment({ recipientId: kasia }),
      [{ field: 'recipientId', code: 'repaymentToSelf' }],
    ],
    [
      'an amount charged for a total of zero',
      usd(receipt({ price: '1' }, { price: '1', refund: true })),
      [{ field: 'manualRate', code: 'chargedWithoutTotal' }],
    ],
    [
      'a Receipt discount larger than the goods',
      { ...receipt({ price: '1' }), discount: { kind: 'amount', value: '2' } },
      [{ field: 'discount', code: 'receiptDiscountExceedsLineItems' }],
    ],
    [
      'more units than bought',
      receipt({ split: { mode: 'units', parts: [{ participantId: kasia, units: 2 }] } }),
      [{ field: 'lineItems', code: 'unitsExceedQuantity' }],
    ],
    [
      'a Contribution from the Main payer',
      plain({ contributions: [{ participantId: kasia, amount: '1' }] }),
      [{ field: 'contributions', code: 'contributionFromMainPayer' }],
    ],
    [
      'a Main payer no longer in the Trip',
      plain({ mainPayerId: '019a2b3c-4d5e-7f00-8a1b-000000000009' }),
      [{ field: 'mainPayerId', code: 'unknownMainPayer' }],
    ],
  ])('%s', (_, draft, reasons) => {
    const reading = readDraft(draft, trip);

    expect(reading.reasons).toEqual(reasons);
    expect(reading.expense).toBeNull();
  });

  it('are not checked at a field that already has a reason', () => {
    expect(readDraft(repayment({ mainPayerId: '' }), trip).reasons).toEqual([
      { field: 'mainPayerId', code: 'missing' },
    ]);
  });
});

describe('a Manual rate', () => {
  it("pointed at the Expense's own currency is dropped, as once it is put in the Trip currency", () => {
    const reading = readDraft(
      plain({ manualRate: { kind: 'charged', value: '5', currency: 'EUR' } }),
      trip,
    );

    expect(reading.manualRate).toBeUndefined();
    expect(reading.expense).not.toHaveProperty('manualRate');
  });
});

describe('what a draft comes to so far', () => {
  it('a Receipt as far as it can be read, what the Main payer covers, and when', () => {
    const draft = receipt({ price: '2', quantity: 5 }, { price: '?' });
    draft.discount = { kind: 'percent', value: '10' };
    draft.contributions = [{ participantId: ania, amount: '1' }];
    const reading = readDraft(draft, trip);

    expect(reading.receipt).toEqual({
      discount: { kind: 'percent', basisPoints: 1000 },
      total: rational(9n),
      discountOff: rational(1n),
      deposits: rational(0n),
      unassigned: rational(0n),
    });
    expect(reading.mainPayerPart).toEqual(rational(8n));
    expect(reading.time).toEqual({ instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' });
  });

  it('Income as a negative total, and nothing while the amount cannot be read', () => {
    expect(readDraft(plain({ received: true, amount: '6' }), trip).total).toEqual(rational(-6n));
    expect(readDraft(plain({ amount: 'six' }), trip).total).toBeNull();
  });
});

describe('transitions with a rule', () => {
  it('itemise as a Receipt: the amount becomes the first Line item, split as ticked, in Trip order', () => {
    const itemised = itemise(plain({ amount: '24,50', participantIds: [ola, kasia] }), trip);

    expect(itemised.lineItems).toMatchObject([
      {
        name: '',
        price: '24,50',
        quantity: 1,
        split: { mode: 'even', participantIds: [kasia, ola] },
      },
    ]);
    expect(itemise(plain({ amount: 'abc' }), trip).lineItems).toEqual([]);
  });

  it('a Main payer cannot have a Contribution', () => {
    const draft = plain({ contributions: [{ participantId: ania, amount: '6' }] });

    expect(pickMainPayer(draft, ania)).toBe('contributes');
    expect(pickMainPayer(draft, ola)).toMatchObject({ mainPayerId: ola });
  });

  it('a new Split mode starts from scratch', () => {
    const [line] = receipt({
      split: { mode: 'units', parts: [{ participantId: kasia, units: 1 }] },
    }).lineItems!;

    expect(chooseSplitMode(line!, 'even', trip.participants).split).toEqual({
      mode: 'even',
      participantIds: [kasia, ania, ola],
    });
    expect(chooseSplitMode(line!, 'amounts', trip.participants).split).toEqual({ mode: 'amounts', parts: [] });
    expect(chooseSplitMode(line!, 'units', trip.participants)).toBe(line);
  });
});
