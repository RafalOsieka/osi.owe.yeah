import { rational, type Expense, type Revision } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { revisionEntries } from '../../app/utils/revisions';

const kasia = '019a2b3c-4d5e-7f00-8a1b-000000000001';

function revision(version: number, unitPrice: number, deleted = false): Revision {
  const expense: Expense = {
    id: '019a2b3c-4d5e-7f00-8a1b-200000000001',
    title: 'Lidl Rovinj',
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: kasia,
    lineItems: [{ unitPrice, split: { mode: 'even', participantIds: [kasia] } }],
  };
  return { version, expense, deleted, edited: { by: kasia, at: '2026-07-15T08:00:00.000Z' } };
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
      revisionEntries(newestFirst).map(({ revision: { version }, kind, before, after }) => ({
        version,
        kind,
        before,
        after,
      })),
    ).toEqual([
      { version: 4, kind: 'restored', before: rational(30n), after: rational(30n) },
      { version: 3, kind: 'deleted', before: rational(30n), after: rational(30n) },
      { version: 2, kind: 'edited', before: rational(4900n, 200n), after: rational(30n) },
      { version: 1, kind: 'added', before: null, after: rational(4900n, 200n) },
    ]);
  });
});
