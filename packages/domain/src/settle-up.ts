import { isRepayment, type Expense } from './expense.ts';
import { minorUnits } from './money.ts';
import {
  add,
  compare,
  floor,
  multiply,
  negate,
  rational,
  roundHalfAwayFromZero,
  subtract,
  type Rational,
} from './rational.ts';
import { expenseRate, type RateEntry, type TripRates } from './rates.ts';
import { expenseShares } from './shares.ts';
import type { TripSnapshot } from './snapshot.ts';

/**
 * What balances are worked out from: the Trip currency, its Participants, its Expenses and
 * the rate table that converts them into the Trip currency.
 */
export type TripExpenses = Pick<TripSnapshot, 'currency' | 'participants'> & {
  expenses: readonly Expense[];
  rates: readonly RateEntry[];
};

/**
 * The Expenses that can be converted into the Trip currency, each with its rate and whether
 * that is a Provisional rate (`expenseRate`); those without one are left out of balances and
 * totals.
 */
export function convertible<E extends Expense>(
  trip: TripRates & { expenses: readonly E[] },
): { expense: E; rate: Rational; provisional: boolean }[] {
  return trip.expenses.flatMap((expense) => {
    const found = expenseRate(expense, trip);
    return found ? [{ expense, ...found }] : [];
  });
}

/**
 * An amount in the Trip currency, and whether it includes one converted at a Provisional rate,
 * so it is approximate.
 */
export type Converted = { amount: Rational; provisional: boolean };

/**
 * What one Participant paid, their share of the costs, and the difference, in the Trip
 * currency. `paid` and `share` include Repayments, which even out `balance`; the Repayment
 * totals tell them apart from spending: `paid` is `paidForExpenses` plus `repaymentsMade`,
 * and their Share of spending is `share` less `repaymentsReceived`.
 */
export type ParticipantBalance = {
  participantId: string;
  paid: Rational;
  /** Whether `paid` includes an amount converted at a Provisional rate, so it is approximate. */
  paidProvisional: boolean;
  share: Rational;
  /** Positive when the Participant is owed money, negative when they owe. */
  balance: Rational;
  /**
   * The balance rounded to the Trip currency's minor units so that all of them add up to
   * zero (see `roundBalances`): what settling up works with.
   */
  rounded: Rational;
  /** What they paid towards Expenses (Income netted in), Repayments left out. */
  paidForExpenses: Converted;
  /** The Repayments they handed over. */
  repaymentsMade: Converted;
  /** The Repayments handed to them. */
  repaymentsReceived: Converted;
};

/**
 * Every Participant's balance, exact and also rounded for settling up, in the order of the
 * Trip's Participants. Each Contribution counts as paid by whoever made it and the Main payer
 * pays the rest; each Line item is shared by its split, and a Repayment counts against its
 * recipient (`expenseShares`). Each Expense is converted into the Trip currency at its rate,
 * and one without a rate is left out (`convertible`).
 */
export function balances(trip: TripExpenses): ParticipantBalance[] {
  const none: Converted = { amount: rational(0n), provisional: false };
  const totals = {
    paidForExpenses: new Map<string, Converted>(),
    repaymentsMade: new Map<string, Converted>(),
    share: new Map<string, Converted>(),
    repaymentsReceived: new Map<string, Converted>(),
  };
  const credit = (
    total: Map<string, Converted>,
    amounts: ReadonlyMap<string, Rational>,
    { rate, provisional }: { rate: Rational; provisional: boolean },
  ) => {
    for (const [id, amount] of amounts) {
      const sum = total.get(id) ?? none;
      total.set(id, {
        amount: add(sum.amount, multiply(amount, rate)),
        // Zero is zero at any rate, so it never makes a total approximate.
        provisional: sum.provisional || (provisional && amount.numerator !== 0n),
      });
    }
  };

  for (const { expense, ...conversion } of convertible(trip)) {
    const parts = expenseShares(expense);
    const repayment = isRepayment(expense);
    credit(repayment ? totals.repaymentsMade : totals.paidForExpenses, parts.paid, conversion);
    credit(totals.share, parts.shares, conversion);
    if (repayment) credit(totals.repaymentsReceived, parts.shares, conversion);
  }

  const exact = trip.participants.map(({ id }) => {
    const paidForExpenses = totals.paidForExpenses.get(id) ?? none;
    const repaymentsMade = totals.repaymentsMade.get(id) ?? none;
    const paid = add(paidForExpenses.amount, repaymentsMade.amount);
    const share = (totals.share.get(id) ?? none).amount;
    return {
      participantId: id,
      paid,
      paidProvisional: paidForExpenses.provisional || repaymentsMade.provisional,
      share,
      balance: subtract(paid, share),
      paidForExpenses,
      repaymentsMade,
      repaymentsReceived: totals.repaymentsReceived.get(id) ?? none,
    };
  });
  const rounded = roundBalances(exact, trip.currency);
  return exact.map((balance, index) => ({ ...balance, rounded: rounded[index]! }));
}

/**
 * A balance's Share of spending, exact and as shown beside its rounded balance: what is left
 * once that is taken from what they paid and the Repayments they received, so the amounts
 * shown add up. The two differ by the rounding.
 */
export function shareOfSpending({ paid, share, rounded, repaymentsReceived }: ParticipantBalance) {
  return {
    exact: subtract(share, repaymentsReceived.amount),
    shown: subtract(subtract(paid, repaymentsReceived.amount), rounded),
  };
}

/**
 * Whether a Trip is Settled: it has Expenses, and every Participant's rounded balance is
 * zero. Derived from the Expenses every time, never stored.
 */
export function isSettled(trip: TripExpenses): boolean {
  return (
    trip.expenses.length > 0 && balances(trip).every(({ rounded }) => rounded.numerator === 0n)
  );
}

/**
 * What the Trip spent in the Trip currency: every Expense's total, net of Income, with
 * Repayments and Expenses without a rate left out.
 */
export function spendingTotal(trip: TripRates & { expenses: readonly Expense[] }): Rational {
  return convertible(trip)
    .filter(({ expense }) => !isRepayment(expense))
    .reduce(
      (sum, { expense, rate }) => add(sum, multiply(expenseShares(expense).total, rate)),
      rational(0n),
    );
}

/** A Repayment the app proposes: `payerId` hands `amount` (Trip currency) to `recipientId`. */
export type SuggestedRepayment = {
  payerId: string;
  recipientId: string;
  amount: Rational;
};

const byId = (a: { participantId: string }, b: { participantId: string }) =>
  a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0;

/**
 * The Suggested Repayments that even out the rounded balances (`ParticipantBalance.rounded`):
 * the biggest debtor pays the biggest creditor, again and again, ties to the lowest
 * Participant id. Each settles at least one of them, so there are at most n − 1. Every
 * device suggests the same, in the same order.
 */
export function suggestedRepayments(
  balances: readonly { participantId: string; rounded: Rational }[],
): SuggestedRepayment[] {
  const zero = rational(0n);
  const open = balances.map(({ participantId, rounded }) => ({ participantId, left: rounded }));
  const suggestions: SuggestedRepayment[] = [];

  for (;;) {
    const debtor = open
      .filter(({ left }) => compare(left, zero) < 0)
      .toSorted((a, b) => compare(a.left, b.left) || byId(a, b))[0];
    const creditor = open
      .filter(({ left }) => compare(left, zero) > 0)
      .toSorted((a, b) => compare(b.left, a.left) || byId(a, b))[0];
    if (!debtor || !creditor) return suggestions;

    const owed = negate(debtor.left);
    const amount = compare(owed, creditor.left) < 0 ? owed : creditor.left;
    suggestions.push({
      payerId: debtor.participantId,
      recipientId: creditor.participantId,
      amount,
    });
    debtor.left = add(debtor.left, amount);
    creditor.left = subtract(creditor.left, amount);
  }
}

/**
 * Exact balances rounded to the currency's minor units with the largest remainder method,
 * so they add up to exactly what the exact ones do (zero in a Trip): each is rounded down,
 * then the units left over go one each to the largest remainders, ties to the lowest
 * Participant id. Every device rounds the same balances the same way. Keeps the order given.
 */
function roundBalances(
  exact: readonly { participantId: string; balance: Rational }[],
  currency: string,
): Rational[] {
  const scale = 10n ** BigInt(minorUnits(currency));
  const scaled = exact.map(({ balance }) =>
    rational(balance.numerator * scale, balance.denominator),
  );
  const floors = scaled.map(floor);

  // Between 0 and the number of balances: each remainder is below one unit.
  const leftOver =
    roundHalfAwayFromZero(scaled.reduce(add, rational(0n))) -
    floors.reduce((total, units) => total + units, 0n);

  const byRemainder = exact
    .map(({ participantId }, index) => ({
      participantId,
      index,
      remainder: subtract(scaled[index]!, rational(floors[index]!)),
    }))
    .toSorted((a, b) => compare(b.remainder, a.remainder) || byId(a, b));
  const roundedUp = new Set(byRemainder.slice(0, Number(leftOver)).map(({ index }) => index));

  return floors.map((units, index) => rational(roundedUp.has(index) ? units + 1n : units, scale));
}
