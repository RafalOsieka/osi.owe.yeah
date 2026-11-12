import { takenOff } from './discount.ts';
import { isRepayment, type Expense, type SplitExpense } from './expense.ts';
import {
  depositMinor,
  goodsMinor,
  isDepositRefund,
  lineNetMinor,
  lineTotalMinor,
  receiptTotalMinor,
  splitWeights,
  type LineItem,
} from './line-item.ts';
import { fromMinor } from './money.ts';
import { add, divide, multiply, negate, rational, subtract, type Rational } from './rational.ts';

/**
 * One Line item's full price, its Line discount, its Deposit, and who bears how much of what
 * that comes to, exact and unrounded, in the Expense currency.
 */
export type LineItemShares = {
  /** Unit price × quantity: the full price. */
  total: Rational;
  /** What the Line discount takes off the full price; zero without one. */
  discountOff: Rational;
  /** The total after the Line discount. */
  net: Rational;
  /** Deposit per unit × quantity, never discounted; zero without one. */
  deposit: Rational;
  /**
   * Each assigned Participant's part of `net` plus `deposit` by id, in the order the split
   * names them.
   */
  shares: ReadonlyMap<string, Rational>;
  /** The part of `net` plus `deposit` nobody has been given yet; zero once fully assigned. */
  unassigned: Rational;
  /** How many of its units nobody has been given yet; only for a Units split. */
  unassignedUnits?: number;
};

/**
 * What a Receipt comes to after both discounts, Deposits and Deposit refunds included, and how
 * much of it each Participant has been given so far, exact and unrounded, in the Expense
 * currency.
 */
export type ReceiptShares = {
  /**
   * The goods after their Line discounts, less the Receipt discount, plus Deposits, less
   * Deposit refunds. Negative when the refunds are bigger than the shopping.
   */
  total: Rational;
  /**
   * The Subtotal: what the Line items come to after their own discounts, before the Receipt
   * discount, Deposits and Deposit refunds.
   */
  subtotal: Rational;
  /** What the Receipt discount takes off; zero without one. */
  discountOff: Rational;
  /** The Line items' Deposits together, to check against those printed on the Receipt. */
  deposits: Rational;
  /** The Deposit refunds together, negative as their row shows them; zero without any. */
  depositRefunds: Rational;
  /** Each assigned Participant's part by id, in the order the splits name them. */
  assigned: ReadonlyMap<string, Rational>;
  /** The value not assigned to anyone yet: non-zero for an incomplete Receipt. */
  unassigned: Rational;
  /**
   * Each Line item's part of `unassigned`, after the Receipt discount, in the Receipt's order:
   * what its own `unassigned` comes to once the Receipt discount is off, adding up to it.
   */
  unassignedByLine: readonly Rational[];
  /** Each Line item's shares before the Receipt discount, in the Receipt's order. */
  lineItems: readonly LineItemShares[];
};

/**
 * What an Expense cost in total, who paid it, and who bears how much of it, exact and
 * unrounded.
 */
export type ExpenseShares = Omit<ReceiptShares, 'assigned'> & {
  /**
   * What each payer paid by id: the Main payer first, covering whatever the Contributions
   * don't, then each Contribution in the order it was added. Adds up to the total.
   */
  paid: ReadonlyMap<string, Rational>;
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
 * `amount` divided in proportion to a Line item's split weights (`splitWeights`): each
 * assigned Participant's part, and the part of the weight nobody has been given. Shared with
 * `shareBreakdown`, so a breakdown's parts add up to the shares exactly.
 */
export function spread(item: LineItem, amount: Rational) {
  const { weights, rest } = splitWeights(item);
  const whole = [...weights.values()].reduce((sum, weight) => sum + weight, rest);
  const part = (weight: bigint) => multiply(amount, divide(rational(weight), rational(whole)));
  return {
    shares: new Map([...weights].map(([id, weight]) => [id, part(weight)])),
    unassigned: part(rest),
  };
}

/**
 * A Line item's full price less its Line discount, plus its Deposit, shared by its split
 * (`spread`), so the discount and the Deposit land on whoever had the item; the weight nobody
 * has been given is the unassigned part, counted in units too for a Units split.
 */
export function lineItemShares(item: LineItem, currency: string): LineItemShares {
  const unit = fromMinor(1, currency);
  const total = multiply(rational(lineTotalMinor(item)), unit);
  const net = multiply(lineNetMinor(item), unit);
  const deposit = multiply(rational(depositMinor(item)), unit);
  return {
    total,
    discountOff: subtract(total, net),
    net,
    deposit,
    ...spread(item, add(net, deposit)),
    ...(item.split.mode === 'units' && { unassignedUnits: Number(splitWeights(item).rest) }),
  };
}

/**
 * A Receipt's Line items shared by their splits (`lineItemShares`), with the Receipt discount
 * spread in proportion to what each Participant, and the value not assigned yet, has of the
 * goods after their Line discounts. Deposits and Deposit refunds are never discounted. Shows
 * the Receipt total while it is entered; `expenseShares` builds on it.
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
  // Every line keeps the same fraction of itself; at zero goods there is nothing to discount.
  const kept = goods.numerator === 0n ? one : subtract(one, divide(off, goods));
  const unit = fromMinor(1, currency);

  const assigned = new Map<string, Rational>();
  let deposits = zero;
  let depositRefunds = zero;
  const unassignedByLine = lineItems.map((item, index) => {
    const { net, deposit } = lines[index]!;
    // A Deposit refund is not goods, so the Receipt discount leaves it whole.
    const left = add(isDepositRefund(item) ? net : multiply(net, kept), deposit);
    const parts = spread(item, left);
    for (const [id, part] of parts.shares) assigned.set(id, add(assigned.get(id) ?? zero, part));
    deposits = add(deposits, deposit);
    if (isDepositRefund(item)) depositRefunds = add(depositRefunds, net);
    return parts.unassigned;
  });
  return {
    total: multiply(receiptTotalMinor(lineItems, discount), unit),
    subtotal: multiply(goods, unit),
    discountOff: multiply(off, unit),
    deposits,
    depositRefunds,
    assigned,
    unassigned: unassignedByLine.reduce(add, zero),
    unassignedByLine,
    lineItems: lines,
  };
}

/**
 * An Expense's total, who paid it, and each Participant's share of it: a Receipt (or plain
 * Expense) is shared as `receiptShares` works out, with the value not assigned yet counted as
 * the Main payer's own, and paid by its Contributions with the Main payer covering the rest;
 * a Repayment is paid by its Main payer and borne wholly by its recipient, which evens out
 * what the payer handed over. Used for balances and to show an Expense.
 */
export function expenseShares(expense: Expense): ExpenseShares {
  const { mainPayerId, currency } = expense;
  if (isRepayment(expense)) {
    const amount = fromMinor(expense.amount, currency);
    return {
      total: amount,
      subtotal: zero,
      discountOff: zero,
      deposits: zero,
      depositRefunds: zero,
      paid: new Map([[mainPayerId, amount]]),
      shares: new Map([[expense.recipientId, amount]]),
      unassigned: zero,
      unassignedByLine: [],
      lineItems: [],
    };
  }

  const { assigned, ...receipt } = receiptShares(expense);
  const shares = new Map(assigned);
  if (receipt.unassigned.numerator !== 0n) {
    shares.set(mainPayerId, add(shares.get(mainPayerId) ?? zero, receipt.unassigned));
  }
  const contributions = (expense.contributions ?? []).map(
    ({ participantId, amount }) => [participantId, fromMinor(amount, currency)] as const,
  );
  const rest = contributions.reduce((left, [, amount]) => subtract(left, amount), receipt.total);
  return { ...receipt, paid: new Map([[mainPayerId, rest], ...contributions]), shares };
}

/**
 * What an Expense means for the Participant this device has claimed:
 * - `lent`: they paid, as Main payer or with a Contribution, for others: what they paid less
 *   their own Share;
 * - `share`: their Share, always the whole of it: when someone else paid, and also when they
 *   paid less than their Share (a Contribution below it, or a Deposit refund shared with
 *   others). What is left for them to pay shows on Balances, not here;
 * - `received`: money they received that is all theirs: an Income for themselves only, or a
 *   Repayment handed to them;
 * - `owe`: the others' part of money they received for others too: an Income (9 received
 *   for three: they owe 6), or a Receipt whose Deposit refunds outweigh its goods;
 * - `getBack`: their part of money someone else received: an Income, or a Deposit refund;
 * - `repaid`: a Repayment they handed over;
 * - `notForYou`: it does not involve them.
 * Amounts are never negative.
 */
export type ClaimView =
  | { kind: 'lent' | 'share' | 'received' | 'owe' | 'getBack' | 'repaid'; amount: Rational }
  | { kind: 'notForYou' };

/** The Claim's view of an Expense (see `ClaimView`); `claimId` is the claimed Participant. */
export function claimView(expense: Expense, claimId: string): ClaimView {
  const { total, paid, shares } = expenseShares(expense);
  const own = shares.get(claimId);
  const payer = expense.mainPayerId === claimId;

  if (isRepayment(expense)) {
    if (payer) return { kind: 'repaid', amount: total };
    return own ? { kind: 'received', amount: total } : { kind: 'notForYou' };
  }
  if (payer && total.numerator < 0n) {
    // Their own part of it is negative (what they keep); the rest is the others'.
    const owed = add(negate(total), own ?? zero);
    return owed.numerator > 0n
      ? { kind: 'owe', amount: owed }
      : { kind: 'received', amount: negate(total) };
  }
  // The Main payer's part, or a Contribution. Below their Share, it falls through to the Share.
  const part = paid.get(claimId);
  if (part) {
    const lent = subtract(part, own ?? zero);
    if (lent.numerator >= 0n) return { kind: 'lent', amount: lent };
  }
  if (!own) return { kind: 'notForYou' };
  return own.numerator < 0n
    ? { kind: 'getBack', amount: negate(own) }
    : { kind: 'share', amount: own };
}
