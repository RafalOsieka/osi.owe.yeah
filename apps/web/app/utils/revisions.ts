import { expenseShares, type Rational, type Revision } from '@osi/owe-yeah-domain';

/** One row of an Expense's History. */
export type RevisionEntry = {
  revision: Revision;
  /** What the change that made it did. */
  kind: 'added' | 'edited' | 'deleted' | 'restored';
  /** The Expense's total before the change; `null` for the first Revision. */
  before: Rational | null;
  after: Rational;
};

/**
 * An Expense's History from its Revisions, newest first: what each change did and how it
 * moved the total.
 */
export function revisionEntries(newestFirst: readonly Revision[]): RevisionEntry[] {
  return newestFirst.map((revision, index) => {
    const previous = newestFirst[index + 1];
    const after = expenseShares(revision.expense).total;
    if (!previous) return { revision, kind: 'added', before: null, after };

    const before = expenseShares(previous.expense).total;
    if (revision.deleted === previous.deleted) return { revision, kind: 'edited', before, after };
    return { revision, kind: revision.deleted ? 'deleted' : 'restored', before, after };
  });
}
