import { takenOff } from './discount.ts';
import { isRepayment, type Expense, type SplitExpense } from './expense.ts';
import {
  goodsMinor,
  lineNetMinor,
  lineTotalMinor,
  splitWeights,
  type LineItem,
} from './line-item.ts';
import { fromMinor } from './money.ts';
import { add, divide, multiply, negate, rational, subtract, type Rational } from './rational.ts';

/**
 * One Line item's full price, its Line discount, and who bears how much of what is left,
 * exact and unrounded, in the Expense currency.
 */
export type LineItemShares = {
  /** Unit price × quantity: the full price. */
  total: Rational;
  /** What the Line discount takes off the full price; zero without one. */
  discountOff: Rational;
  /** The total after the Line discount, which the split shares. */
  net: Rational;
  /** Each assigned Participant's part of `net` by id, in the order the split names them. */
  shares: ReadonlyMap<string, Rational>;
  /** The part of `net` nobody has been given yet; zero once the line is fully assigned. */
  unassigned: Rational;
};

/**
 * What a Receipt's Line items come to after both discounts, and how much of it each
 * Participant has been given so far, exact and unrounded, in the Expense currency.
 */
export type ReceiptShares = {
  /** The Line items after their Line discounts, less the Receipt discount. */
  total: Rational;
  /** What the Receipt discount takes off; zero without one. */
  discountOff: Rational;
  /** Each assigned Participant's part by id, in the order the splits name them. */
  assigned: ReadonlyMap<string, Rational>;
  /** The value not assigned to anyone yet: non-zero for an incomplete Receipt. */
  unassigned: Rational;
  /** Each Line item's shares before the Receipt discount, in the Receipt's order. */
  lineItems: readonly LineItemShares[];
};

/** What an Expense cost in total, and who bears how much of it, exact and unrounded. */
export type ExpenseShares = Omit<ReceiptShares, 'assigned'> & {
  /**
   * Each Participant's share by id, in the order the splits name them. The Main payer's
   * includes the value not assigned yet, which is theirs until it is. A Repayment's
   * recipient bears all of it.
   */
  shares: ReadonlyMap<string, Rational>;
};

const zero = rational(0n);
const one = rational(1n);

/**
 * A Line item's full price less its Line discount, shared in proportion to its split's
 * weights (`splitWeights`), so the discount lands on whoever had the item; the weight nobody
 * has been given is the unassigned part.
 */
export function lineItemShares(item: LineItem, currency: string): LineItemShares {
  const total = multiply(rational(lineTotalMinor(item)), fromMinor(1, currency));
  const net = multiply(lineNetMinor(item), fromMinor(1, currency));
  const { weights, rest } = splitWeights(item);
  const whole = [...weights.values()].reduce((sum, weight) => sum + weight, rest);
  const part = (weight: bigint) => multiply(net, divide(rational(weight), rational(whole)));
  return {
    total,
    discountOff: subtract(total, net),
    net,
    shares: new Map([...weights].map(([id, weight]) => [id, part(weight)])),
    unassigned: part(rest),
  };
}

/**
 * A Receipt's Line items shared by their splits (`lineItemShares`), then the Receipt
 * discount spread in proportion to what each Participant, and the value not assigned yet,
 * has after Line discounts. Shows the Receipt total while it is entered; `expenseShares`
 * builds on it.
 */
export function receiptShares({
  lineItems,
  discount,
  currency,
}: Pick<SplitExpense, 'lineItems' | 'discount' | 'currency'>): ReceiptShares {
  const lines = lineItems.map((item) => lineItemShares(item, currency));
  // In minor units, as the Receipt discount is entered.
  const goods = goodsMinor(lineItems);
  const off = takenOff(discount, goods);
  // Every part keeps the same fraction of itself; at zero goods there is nothing to discount.
  const kept = goods.numerator === 0n ? one : subtract(one, divide(off, goods));
  const unit = fromMinor(1, currency);

  const assigned = new Map<string, Rational>();
  for (const line of lines) {
    for (const [id, part] of line.shares) assigned.set(id, add(assigned.get(id) ?? zero, part));
  }
  for (const [id, part] of assigned) assigned.set(id, multiply(part, kept));
  const unassigned = lines.reduce((sum, line) => add(sum, line.unassigned), zero);
  return {
    total: multiply(subtract(goods, off), unit),
    discountOff: multiply(off, unit),
    assigned,
    unassigned: multiply(unassigned, kept),
    lineItems: lines,
  };
}

/**
 * An Expense's total and each Participant's share of it: a Receipt (or plain Expense) is
 * shared as `receiptShares` works out, with the value not assigned yet counted as the Main
 * payer's own, and a Repayment is borne wholly by its recipient, which evens out what the
 * payer handed over. Used for balances and to show an Expense.
 */
export function expenseShares(expense: Expense): ExpenseShares {
  if (isRepayment(expense)) {
    const amount = fromMinor(expense.amount, expense.currency);
    return {
      total: amount,
      discountOff: zero,
      shares: new Map([[expense.recipientId, amount]]),
      unassigned: zero,
      lineItems: [],
    };
  }

  const { assigned, ...receipt } = receiptShares(expense);
  const shares = new Map(assigned);
  if (receipt.unassigned.numerator !== 0n) {
    const { mainPayerId } = expense;
    shares.set(mainPayerId, add(shares.get(mainPayerId) ?? zero, receipt.unassigned));
  }
  return { ...receipt, shares };
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
