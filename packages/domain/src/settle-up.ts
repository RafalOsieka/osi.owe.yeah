import { isRepayment, type Expense } from './expense.ts';
import { minorUnits } from './money.ts';
import {
  add,
  compare,
  floor,
  negate,
  rational,
  roundHalfAwayFromZero,
  subtract,
  type Rational,
} from './rational.ts';
import { expenseShares } from './shares.ts';
import type { TripSnapshot } from './snapshot.ts';

/** What balances are worked out from: the Trip currency, its Participants and its Expenses. */
type TripExpenses = Pick<TripSnapshot, 'currency' | 'participants'> & {
  expenses: readonly Expense[];
};

/** What one Participant paid, their share of the costs, and the difference, in the Trip currency. */
export type ParticipantBalance = {
  participantId: string;
  paid: Rational;
  share: Rational;
  /** Positive when the Participant is owed money, negative when they owe. */
  balance: Rational;
  /**
   * The balance rounded to the Trip currency's minor units so that all of them add up to
   * zero (see `roundBalances`): what settling up works with.
   */
  rounded: Rational;
};

/**
 * Every Participant's balance, exact and also rounded for settling up, in the order of the
 * Trip's Participants. The Main payer pays each Expense in full; each Line item is split
 * evenly between its ticked Participants, and a Repayment counts against its recipient.
 * Expenses must be in the Trip currency (`expenseProblems` enforces it).
 */
export function balances(trip: TripExpenses): ParticipantBalance[] {
  const zero = rational(0n);
  const paid = new Map<string, Rational>();
  const share = new Map<string, Rational>();
  const credit = (totals: Map<string, Rational>, id: string, amount: Rational) =>
    totals.set(id, add(totals.get(id) ?? zero, amount));

  for (const expense of trip.expenses) {
    if (expense.currency !== trip.currency) {
      throw new RangeError(`Expense ${expense.id} is not in the Trip currency`);
    }
    const { total, shares } = expenseShares(expense);
    credit(paid, expense.mainPayerId, total);
    for (const [id, part] of shares) credit(share, id, part);
  }

  const exact = trip.participants.map(({ id }) => {
    const participantPaid = paid.get(id) ?? zero;
    const participantShare = share.get(id) ?? zero;
    return {
      participantId: id,
      paid: participantPaid,
      share: participantShare,
      balance: subtract(participantPaid, participantShare),
    };
  });
  const rounded = roundBalances(exact, trip.currency);
  return exact.map((balance, index) => ({ ...balance, rounded: rounded[index]! }));
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

/** What the Trip spent: every Expense's total, net of Income, with Repayments left out. */
export function spendingTotal(expenses: readonly Expense[]): Rational {
  return expenses
    .filter((expense) => !isRepayment(expense))
    .reduce((sum, expense) => add(sum, expenseShares(expense).total), rational(0n));
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
