import { isRepayment, type Expense } from './expense.ts';
import { fromMinor } from './money.ts';
import { add, negate, rational, subtract, type Rational } from './rational.ts';

/** What an Expense cost in total, and who bears how much of it, exact and unrounded. */
export type ExpenseShares = {
  /** The sum of the Line items, or what a Repayment handed over, in the Expense currency. */
  total: Rational;
  /** Each ticked Participant's share by id, in the order they were ticked. */
  shares: ReadonlyMap<string, Rational>;
};

/**
 * An Expense's total and each Participant's share of it: every Line item is split evenly
 * between its ticked Participants, and a Repayment is borne wholly by its recipient, which
 * evens out what the payer handed over. Used for balances and to show an Expense.
 */
export function expenseShares(expense: Expense): ExpenseShares {
  if (isRepayment(expense)) {
    const amount = fromMinor(expense.amount, expense.currency);
    return { total: amount, shares: new Map([[expense.recipientId, amount]]) };
  }

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
 * What an Expense means for the Participant this device has claimed:
 * - `lent`: they paid, for others: the total less their own share;
 * - `share`: someone else paid, and this is their share;
 * - `received`: the whole of an Income they received, or of a Repayment handed to them;
 * - `getBack`: their part of an Income someone else received;
 * - `repaid`: a Repayment they handed over;
 * - `notForYou`: it does not involve them.
 * Amounts are never negative.
 */
export type ClaimView =
  | { kind: 'lent' | 'share' | 'received' | 'getBack' | 'repaid'; amount: Rational }
  | { kind: 'notForYou' };

/** The Claim's view of an Expense (see `ClaimView`); `claimId` is the claimed Participant. */
export function claimView(expense: Expense, claimId: string): ClaimView {
  const { total, shares } = expenseShares(expense);
  const own = shares.get(claimId);
  const payer = expense.mainPayerId === claimId;

  if (isRepayment(expense)) {
    if (payer) return { kind: 'repaid', amount: total };
    return own ? { kind: 'received', amount: total } : { kind: 'notForYou' };
  }
  if (total.numerator < 0n) {
    if (payer) return { kind: 'received', amount: negate(total) };
    return own ? { kind: 'getBack', amount: negate(own) } : { kind: 'notForYou' };
  }
  if (payer) return { kind: 'lent', amount: own ? subtract(total, own) : total };
  return own ? { kind: 'share', amount: own } : { kind: 'notForYou' };
}
