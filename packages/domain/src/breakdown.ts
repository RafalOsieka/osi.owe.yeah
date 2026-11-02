import { takenOff } from './discount.ts';
import { isReceipt, isRepayment, type Expense } from './expense.ts';
import { fromMinor } from './money.ts';
import { goodsMinor, isDepositRefund } from './line-item.ts';
import { add, divide, multiply, negate, rational, type Rational } from './rational.ts';
import type { TripExpenses } from './settle-up.ts';
import { lineItemShares, receiptShares, spread } from './shares.ts';

/**
 * Where part of a share comes from, in the order a breakdown lists them:
 * - `expenses`: plain Expenses;
 * - `goods`: a Receipt's goods at full price;
 * - `lineDiscounts`, `receiptDiscounts`: what the discounts take off (negative);
 * - `deposits`: Deposits, never discounted;
 * - `depositRefunds`: Deposit refunds (negative);
 * - `unassigned`: a Receipt's value nobody has been given yet, the Main payer's own until it is;
 * - `income`: Income (negative);
 * - `repayments`: Repayments received, which even out what their payers handed over.
 */
export const BREAKDOWN_PARTS = [
  'expenses',
  'goods',
  'lineDiscounts',
  'deposits',
  'depositRefunds',
  'receiptDiscounts',
  'unassigned',
  'income',
  'repayments',
] as const;

export type BreakdownPart = (typeof BREAKDOWN_PARTS)[number];

/** A Participant's share and the parts it comes from, exact and unrounded. */
export type ShareBreakdown = {
  share: Rational;
  /** The parts that are not zero, in `BREAKDOWN_PARTS` order; they add up to `share`. */
  parts: readonly { part: BreakdownPart; amount: Rational }[];
};

/** Each Participant's running total of every part, by id. */
type PartTotals = Map<string, Map<BreakdownPart, Rational>>;

const zero = rational(0n);

/**
 * Adds an Expense's parts to `totals`. Spreads every amount by its Line item's split as
 * `receiptShares` does, so the parts add up to the shares `expenseShares` gives.
 */
function addExpense(totals: PartTotals, expense: Expense): void {
  const credit = (part: BreakdownPart, amounts: ReadonlyMap<string, Rational>) => {
    for (const [id, amount] of amounts) {
      const parts = totals.get(id) ?? new Map<BreakdownPart, Rational>();
      parts.set(part, add(parts.get(part) ?? zero, amount));
      totals.set(id, parts);
    }
  };

  if (isRepayment(expense)) {
    credit(
      'repayments',
      new Map([[expense.recipientId, fromMinor(expense.amount, expense.currency)]]),
    );
    return;
  }
  const { lineItems, discount, currency, mainPayerId } = expense;
  const { total, assigned, unassigned } = receiptShares(expense);
  if (isReceipt(expense)) {
    // The fraction of the goods the Receipt discount takes off.
    const goods = goodsMinor(lineItems);
    const off = goods.numerator === 0n ? zero : divide(takenOff(discount, goods), goods);
    for (const item of lineItems) {
      const line = lineItemShares(item, currency);
      const byWeight = (amount: Rational) => spread(item, amount).shares;
      if (isDepositRefund(item)) {
        credit('depositRefunds', byWeight(line.net));
        continue;
      }
      credit('goods', byWeight(line.total));
      credit('lineDiscounts', byWeight(negate(line.discountOff)));
      credit('deposits', byWeight(line.deposit));
      credit('receiptDiscounts', byWeight(negate(multiply(line.net, off))));
    }
  } else {
    credit(total.numerator < 0n ? 'income' : 'expenses', assigned);
  }
  // Whatever nobody has been given yet is the Main payer's own until it is.
  if (unassigned.numerator !== 0n) credit('unassigned', new Map([[mainPayerId, unassigned]]));
}

function toBreakdown(parts: ReadonlyMap<BreakdownPart, Rational> | undefined): ShareBreakdown {
  const listed = BREAKDOWN_PARTS.flatMap((part) => {
    const amount = parts?.get(part) ?? zero;
    return amount.numerator === 0n ? [] : [{ part, amount }];
  });
  return { share: listed.reduce((sum, { amount }) => add(sum, amount), zero), parts: listed };
}

/**
 * Where each Participant's share of an Expense comes from, by id, for everyone it is shared
 * with (the Main payer too while value is not assigned yet). Shown from a share on an
 * Expense's detail page.
 */
export function shareBreakdown(expense: Expense): ReadonlyMap<string, ShareBreakdown> {
  const totals: PartTotals = new Map();
  addExpense(totals, expense);
  return new Map([...totals].map(([id, parts]) => [id, toBreakdown(parts)]));
}

/**
 * Where each Participant's share of the whole Trip comes from, every part added up over its
 * Expenses: the share `balances` works with. Every Participant by id, in the Trip's order.
 * Expenses must be in the Trip currency, as for `balances`. Shown from a Participant's bar
 * on the Balances tab.
 */
export function shareBreakdowns(trip: TripExpenses): ReadonlyMap<string, ShareBreakdown> {
  const totals: PartTotals = new Map();
  for (const expense of trip.expenses) addExpense(totals, expense);
  return new Map(trip.participants.map(({ id }) => [id, toBreakdown(totals.get(id))]));
}
