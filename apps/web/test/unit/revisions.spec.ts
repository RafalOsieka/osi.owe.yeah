import { rational, type Currency, type Expense, type Revision } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { changedFields, revisionEntries, type RevisionTotal } from '../../app/utils/revisions';

const kasia = '019a2b3c-4d5e-7f00-8a1b-000000000001';
const tomek = '019a2b3c-4d5e-7f00-8a1b-000000000002';

function revision(
  version: number,
  unitPrice: number,
  deleted = false,
  currency: Currency = 'EUR',
): Revision {
  const expense: Expense = {
    id: '019a2b3c-4d5e-7f00-8a1b-200000000001',
    title: 'Lidl Rovinj',
    currency,
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: kasia,
    lineItems: [
      { name: '', unitPrice, quantity: 1, split: { mode: 'even', participantIds: [kasia] } },
    ],
  };
  return { version, expense, deleted, edited: { by: kasia, at: '2026-07-15T08:00:00.000Z' } };
}

function eur(numerator: bigint, denominator?: bigint): RevisionTotal {
  return { amount: rational(numerator, denominator), currency: 'EUR' };
}

describe('revisionEntries', () => {
  it('says what each Revision did, with the total before and after it', () => {
    const newestFirst = [
      revision(4, 3000),
      revision(3, 3000, true),
      revision(2, 3000),
      revision(1, 2450),
    ];

    expect(
      revisionEntries(newestFirst).map(
        ({ revision: { version }, kind, before, after, changed }) => ({
          version,
          kind,
          before,
          after,
          changed,
        }),
      ),
    ).toEqual([
      { version: 4, kind: 'restored', before: eur(30n), after: eur(30n), changed: [] },
      { version: 3, kind: 'deleted', before: eur(30n), after: eur(30n), changed: [] },
      {
        version: 2,
        kind: 'edited',
        before: eur(4900n, 200n),
        after: eur(30n),
        changed: ['amount'],
      },
      { version: 1, kind: 'added', before: null, after: eur(4900n, 200n), changed: [] },
    ]);
  });

  it('keeps the total before a currency edit in its own currency', () => {
    const [edited] = revisionEntries([revision(2, 3000), revision(1, 3000, false, 'PLN')]);

    expect(edited).toMatchObject({
      before: { amount: rational(30n), currency: 'PLN' },
      after: eur(30n),
    });
  });
});

describe('changedFields', () => {
  const base = revision(1, 3000).expense;

  it('names what differs, not what only moved with it', () => {
    const edited: Expense = {
      ...base,
      title: 'Lidl Split',
      lineItems: [
        {
          name: '',
          unitPrice: 4000,
          quantity: 1,
          split: { mode: 'even', participantIds: [kasia, tomek] },
        },
      ],
    };

    expect(changedFields(base, edited)).toEqual(['title', 'amount', 'forWhom']);
  });

  it('names the amount with the currency, as the same number is other money', () => {
    const inPln: Expense = { ...base, currency: 'PLN' };

    expect(changedFields(base, inPln)).toEqual(['amount', 'currency']);
  });

  it('finds nothing when only the order of the keys differs', () => {
    // SAFETY: the same entries as `base`, an Expense, only in reverse order.
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as Expense;

    expect(changedFields(base, reordered)).toEqual([]);
  });
});
