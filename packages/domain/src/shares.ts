import { isRepayment, type Expense } from './expense.ts';
import { splitWeights, type LineItem } from './line-item.ts';
import { fromMinor } from './money.ts';
import { add, divide, multiply, negate, rational, subtract, type Rational } from './rational.ts';

/** One Line item's full-price total and who bears how much of it, exact and unrounded. */
export type LineItemShares = {
  /** Unit price × quantity, in the Expense currency. */
  total: Rational;
  /** Each assigned Participant's part by id, in the order the split names them. */
  shares: ReadonlyMap<string, Rational>;
  /** The part nobody has been given yet; zero once the line is fully assigned. */
  unassigned: Rational;
};

/** What an Expense cost in total, and who bears how much of it, exact and unrounded. */
export type ExpenseShares = {
  /** The sum of the Line items, or what a Repayment handed over, in the Expense currency. */
  total: Rational;
  /**
   * Each Participant's share by id, in the order the splits name them. The Main payer's
   * includes the value not assigned yet, which is theirs until it is.
   */
  shares: ReadonlyMap<string, Rational>;
  /** The value not assigned to anyone yet: non-zero for an incomplete Receipt. */
  unassigned: Rational;
  /** Each Line item's shares, in the Expense's order; none for a Repayment. */
  lineItems: readonly LineItemShares[];
};

const zero = rational(0n);

/**
 * A Line item's total shared in proportion to its split's weights (`splitWeights`); the
 * weight nobody has been given is the unassigned part.
 */
export function lineItemShares(item: LineItem, currency: string): LineItemShares {
  const total = multiply(fromMinor(item.unitPrice, currency), rational(BigInt(item.quantity)));
  const { weights, rest } = splitWeights(item);
  const whole = [...weights.values()].reduce((sum, weight) => sum + weight, rest);
  const part = (weight: bigint) => multiply(total, divide(rational(weight), rational(whole)));
  return {
    total,
    shares: new Map([...weights].map(([id, weight]) => [id, part(weight)])),
    unassigned: part(rest),
  };
}

/**
 * An Expense's total and each Participant's share of it: every Line item is shared by its
 * split, the value not assigned yet counts as the Main payer's own, and a Repayment is borne
 * wholly by its recipient, which evens out what the payer handed over. Used for balances
 * and to show an Expense.
 */
export function expenseShares(expense: Expense): ExpenseShares {
  if (isRepayment(expense)) {
    const amount = fromMinor(expense.amount, expense.currency);
    return {
      total: amount,
      shares: new Map([[expense.recipientId, amount]]),
      unassigned: zero,
      lineItems: [],
    };
  }

  const lineItems = expense.lineItems.map((item) => lineItemShares(item, expense.currency));
  const shares = new Map<string, Rational>();
  const credit = (id: string, amount: Rational) =>
    shares.set(id, add(shares.get(id) ?? zero, amount));
  for (const line of lineItems) for (const [id, part] of line.shares) credit(id, part);

  const unassigned = lineItems.reduce((sum, line) => add(sum, line.unassigned), zero);
  if (unassigned.numerator !== 0n) credit(expense.mainPayerId, unassigned);
  return {
    total: lineItems.reduce((sum, line) => add(sum, line.total), zero),
    shares,
    unassigned,
    lineItems,
  };
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
