import type { Expense } from './expense.ts';
import { fromMinor } from './money.ts';
import { add, rational, subtract, type Rational } from './rational.ts';

/** What an Expense cost in total, and who bears how much of it, exact and unrounded. */
export type ExpenseShares = {
  /** The sum of the Line items, in the Expense currency. */
  total: Rational;
  /** Each ticked Participant's share by id, in the order they were ticked. */
  shares: ReadonlyMap<string, Rational>;
};

/**
 * An Expense's total and each Participant's share of it: every Line item is split evenly
 * between its ticked Participants. Used for balances and to show an Expense.
 */
export function expenseShares(expense: Pick<Expense, 'currency' | 'lineItems'>): ExpenseShares {
  const zero = rational(0n);
  let total = zero;
  const shares = new Map<string, Rational>();

  for (const { unitPrice, split } of expense.lineItems) {
    const price = fromMinor(unitPrice, expense.currency);
    total = add(total, price);
    const part = rational(price.numerator, price.denominator * BigInt(split.participantIds.length));
    for (const id of split.participantIds) shares.set(id, add(shares.get(id) ?? zero, part));
  }
  return { total, shares };
}

/**
 * What an Expense means for the Participant this device has claimed: what they lent when
 * they paid, their share when someone else paid for them, or that it is not for them.
 */
export type ClaimView =
  | { kind: 'lent'; amount: Rational }
  | { kind: 'share'; amount: Rational }
  | { kind: 'notForYou' };

/** The Claim's view of an Expense (see `ClaimView`); `claimId` is the claimed Participant. */
export function claimView(
  expense: Pick<Expense, 'currency' | 'lineItems' | 'mainPayerId'>,
  claimId: string,
): ClaimView {
  const { total, shares } = expenseShares(expense);
  const own = shares.get(claimId);
  if (expense.mainPayerId === claimId) {
    return { kind: 'lent', amount: own ? subtract(total, own) : total };
  }
  return own ? { kind: 'share', amount: own } : { kind: 'notForYou' };
}
