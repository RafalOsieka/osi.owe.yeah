import {
  compare,
  expenseSchema,
  expenseKind,
  expenseShares,
  isRepayment,
  type Currency,
  type Expense,
  type Rational,
  type Revision,
} from '@osi/owe-yeah-domain';

/**
 * What can differ between two versions of an Expense, as History and the Conflict screen name
 * it: `forWhom` is who it is for, or who got a Repayment; `lineItems` any change to a
 * Receipt's Line items or Receipt discount that `amount` and `forWhom` don't already say.
 */
const EXPENSE_FIELDS = [
  'title',
  'amount',
  'currency',
  'when',
  'paidBy',
  'forWhom',
  'lineItems',
  'rate',
] as const;
export type ExpenseField = (typeof EXPENSE_FIELDS)[number];

// The same value. Both sides come from `changedFields`'s schema-read versions, built the
// same way, so their keys are in one order.
function same<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What differs between two versions of the same Expense, in `EXPENSE_FIELDS` order; only
 * what the Expense is, not the device's sync state, so either can be a device's own version.
 * A currency change changes the amount too: the same number in another currency is other money.
 */
export function changedFields(given: Expense, now: Expense): ExpenseField[] {
  // Read through the schema, so their keys come in its order, whichever device wrote them.
  const before = expenseSchema.parse(given);
  const after = expenseSchema.parse(now);
  const receipt = (expense: Expense) => expenseKind(expense).kind === 'receipt';
  const items = (expense: Expense) =>
    isRepayment(expense) ? null : { lineItems: expense.lineItems, discount: expense.discount };
  const paidBy = (expense: Expense) => ({
    mainPayerId: expense.mainPayerId,
    contributions: isRepayment(expense) ? undefined : expense.contributions,
  });
  // Who it is for, not their shares: those move with the amount.
  const forWhom = (expense: Expense) => [...expenseShares(expense).shares.keys()].sort();
  const differs = {
    title: before.title !== after.title,
    amount: !sameTotal(revisionTotal(before), revisionTotal(after)),
    currency: before.currency !== after.currency,
    when: !same(before.time, after.time),
    paidBy: !same(paidBy(before), paidBy(after)),
    forWhom: !same(forWhom(before), forWhom(after)),
    // A plain Expense's one Line item is its amount and who it is for, said above already.
    lineItems: (receipt(before) || receipt(after)) && !same(items(before), items(after)),
    rate: !same(before.manualRate, after.manualRate),
  } satisfies Record<ExpenseField, boolean>;
  return EXPENSE_FIELDS.filter((field) => differs[field]);
}

/** An Expense's total, in the currency of the Revision it is from. */
export type RevisionTotal = { amount: Rational; currency: Currency };

function revisionTotal(expense: Expense): RevisionTotal {
  return { amount: expenseShares(expense).total, currency: expense.currency };
}

/** Whether two totals are the same money: the same number in another currency is not. */
export function sameTotal(a: RevisionTotal, b: RevisionTotal): boolean {
  return a.currency === b.currency && compare(a.amount, b.amount) === 0;
}

/** One row of an Expense's History. */
export type RevisionEntry = {
  revision: Revision;
  /** What the change that made it did. */
  kind: 'added' | 'edited' | 'deleted' | 'restored';
  /** The Expense's total before the change; `null` for the first Revision. */
  before: RevisionTotal | null;
  after: RevisionTotal;
  /** What an edit changed; empty for any other change. */
  changed: ExpenseField[];
};

/**
 * An Expense's History from its Revisions, newest first: what each change did, how it moved
 * the total and, for an edit, what it changed.
 */
export function revisionEntries(newestFirst: readonly Revision[]): RevisionEntry[] {
  return newestFirst.map((revision, index) => {
    const previous = newestFirst[index + 1];
    const after = revisionTotal(revision.expense);
    if (!previous) return { revision, kind: 'added', before: null, after, changed: [] };

    const before = revisionTotal(previous.expense);
    if (revision.deleted === previous.deleted) {
      const changed = changedFields(previous.expense, revision.expense);
      return { revision, kind: 'edited', before, after, changed };
    }
    const kind = revision.deleted ? 'deleted' : 'restored';
    return { revision, kind, before, after, changed: [] };
  });
}
