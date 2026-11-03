import {
  TRIP_CURRENCIES,
  add,
  balances,
  currencySchema,
  expenseProblems,
  expenseSchema,
  expenseTimeFromLocal,
  minorUnits,
  negate,
  rational,
  referencedParticipantIds,
  tripWithParticipantsSchema,
  type Expense,
  type Participant,
  type Rational,
  type Split,
  type TripCurrency,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { TricountMoney, TricountRegistry } from './tricount.ts';

/**
 * A Tricount mapped to a new, ordinary Trip, checked by the domain package and ready to be
 * written. `tricountBalances` is each Participant's balance as Tricount works it out from its
 * stored allocations, in the Trip currency's minor units: what the Trip's balances must match.
 */
export type ImportedTrip = {
  trip: TripWithParticipants;
  expenses: Expense[];
  tricountBalances: Map<string, bigint>;
  /** Entries left out: deleted ones, and those of no amount. */
  skipped: number;
};

type Entry = TricountRegistry['entries'][number];

/** What mapping one entry needs besides the entry itself. */
type Mapping = {
  currency: TripCurrency;
  zone: string;
  idOf: (memberId: number) => string;
};

/**
 * Maps a Tricount to a new Trip. Its base currency becomes the Trip currency, and members
 * become Participants with fresh ids, except deleted ones no imported Expense references.
 * Each active entry becomes a plain Expense with one Line item: `NORMAL` an Expense, `INCOME`
 * Income and `BALANCE` a Repayment, with signs normalised. Equal ratios become Even when Even
 * comes to exactly the stored allocations; anything else becomes Amounts from them, so the
 * cents Tricount rounded stay where it put them. A foreign entry keeps its own currency and
 * gets a Manual rate in its charged-amount form: what it came to in the base currency. Entry
 * times are read as local wall-clock time in `zone`. Throws when something can't be imported.
 */
export function importTricount(registry: TricountRegistry, zone: string): ImportedTrip {
  const currency = tripCurrency(registry.currency);
  const ids = new Map(registry.members.map(({ id }) => [id, uuidv7()]));
  const idOf = (memberId: number) => {
    const id = ids.get(memberId);
    if (!id) throw new Error(`An entry names member ${memberId}, who is not in the Tricount`);
    return id;
  };
  const mapping: Mapping = { currency, zone, idOf };

  const owed = new Map<string, bigint>();
  const credit = (id: string, minor: bigint) => owed.set(id, (owed.get(id) ?? 0n) + minor);
  const expenses: Expense[] = [];
  let skipped = 0;
  for (const entry of registry.entries) {
    if (entry.amount.currency !== currency) {
      throw new Error(`${entryLabel(entry)} is not in the Tricount currency ${currency}`);
    }
    const amount = minorMagnitude(entry.amount);
    if (!entry.active || amount === 0n) {
      skipped++;
      continue;
    }
    expenses.push(toExpense(entry, mapping));
    // Income is the mirror image of an Expense: whoever received it owes it to the others.
    const sign = entry.kind === 'INCOME' ? -1n : 1n;
    credit(idOf(entry.payerId), sign * amount);
    for (const allocation of entry.allocations) {
      credit(idOf(allocation.memberId), -sign * minorMagnitude(allocation.amount));
    }
  }

  const referenced = new Set(expenses.flatMap((expense) => [...referencedParticipantIds(expense)]));
  const participants = registry.members
    .filter(({ id, deleted }) => !deleted || referenced.has(idOf(id)))
    .map(({ id, name }) => ({ id: idOf(id), name: name.trim().slice(0, 50) || 'Unnamed' }));
  const trip = tripWithParticipantsSchema.parse({
    id: uuidv7(),
    name: registry.title.trim().slice(0, 100) || 'Tricount',
    currency,
    participants,
  });

  return {
    trip,
    expenses: expenses.map((expense) => validInTrip(expense, trip)),
    tricountBalances: new Map(participants.map(({ id }) => [id, owed.get(id) ?? 0n])),
    skipped,
  };
}

/** One active entry as a plain Expense, Income or Repayment (see `importTricount`). */
function toExpense(entry: Entry, { currency, zone, idOf }: Mapping): Expense {
  const foreign =
    entry.amountLocal && entry.amountLocal.currency !== currency ? entry.amountLocal : undefined;
  const paid = foreign ?? entry.amount;
  const total = minorMagnitude(paid);
  const mainPayerId = idOf(entry.payerId);
  // Who the entry is for, in the currency it was paid in; zero parts are nobody's.
  const parts = entry.allocations
    .map((allocation) => {
      const local = foreign ? allocation.amountLocal : allocation.amount;
      if (local?.currency !== paid.currency) {
        throw new Error(`${entryLabel(entry)} has a part without an amount in ${paid.currency}`);
      }
      return {
        participantId: idOf(allocation.memberId),
        amount: minorMagnitude(local),
        ratio: allocation.ratio,
      };
    })
    .filter(({ amount }) => amount > 0n);

  const base = {
    id: uuidv7(),
    title: entry.description.trim().slice(0, 100) || TITLES[entry.kind],
    currency: currencySchema.parse(paid.currency),
    time: expenseTimeFromLocal(entry.date.replace(' ', 'T'), zone),
    mainPayerId,
  };
  const expense: Expense =
    entry.kind === 'BALANCE'
      ? { ...base, recipientId: recipientOf(entry, parts, mainPayerId), amount: Number(total) }
      : {
          ...base,
          lineItems: [
            {
              name: '',
              unitPrice: Number(entry.kind === 'INCOME' ? -total : total),
              quantity: 1,
              split: splitOf(entry, parts, total),
            },
          ],
        };
  if (foreign) {
    expense.manualRate = {
      kind: 'charged',
      amount: Number(minorMagnitude(entry.amount)),
      currency,
    };
  }
  return expense;
}

const TITLES = { NORMAL: 'Expense', INCOME: 'Income', BALANCE: 'Repayment' } as const;

type Part = { participantId: string; amount: bigint; ratio: number | null };

/** A `BALANCE` entry's recipient: the one allocation with an amount, someone besides the payer. */
function recipientOf(entry: Entry, parts: readonly Part[], payerId: string): string {
  const [recipient, ...more] = parts;
  if (!recipient || more.length > 0 || recipient.participantId === payerId) {
    throw new Error(`${entryLabel(entry)} is a Repayment without exactly one recipient`);
  }
  return recipient.participantId;
}

/**
 * Even when every part has the same ratio and Even comes to exactly the stored amounts;
 * otherwise Amounts as stored, which add up to the total.
 */
function splitOf(entry: Entry, parts: readonly Part[], total: bigint): Split {
  const [first] = parts;
  if (!first) throw new Error(`${entryLabel(entry)} is for nobody`);
  const even = parts.every(
    ({ ratio, amount }) =>
      ratio !== null && ratio === first.ratio && amount * BigInt(parts.length) === total,
  );
  return even
    ? { mode: 'even', participantIds: parts.map(({ participantId }) => participantId) }
    : {
        mode: 'amounts',
        parts: parts.map(({ participantId, amount }) => ({
          participantId,
          amount: Number(amount),
        })),
      };
}

/** The Expense as the domain package reads it, after checking it fits its Trip. */
function validInTrip(expense: Expense, trip: TripWithParticipants): Expense {
  const parsed = expenseSchema.parse(expense);
  const problems = expenseProblems(parsed, trip);
  if (problems.length > 0) {
    throw new Error(`"${parsed.title}" breaks the Trip's rules: ${problems.join(', ')}`);
  }
  return parsed;
}

/** The Tricount currency as a Trip currency, which only rate-provider currencies can be. */
function tripCurrency(currency: string): TripCurrency {
  const parsed = z.enum(TRIP_CURRENCIES).safeParse(currency);
  if (!parsed.success) {
    throw new Error(`The Tricount currency ${currency} can't be a Trip currency`);
  }
  return parsed.data;
}

/** An amount's size in its currency's minor units, e.g. `-12.50` EUR → 1250. */
function minorMagnitude({ value, currency }: TricountMoney): bigint {
  const [whole = '', fraction = ''] = value.replace('-', '').split('.');
  const units = minorUnits(currency);
  if (/[1-9]/.test(fraction.slice(units))) {
    throw new Error(`${value} has more decimals than ${currency} has`);
  }
  return BigInt(whole + fraction.slice(0, units).padEnd(units, '0'));
}

/** How errors name an entry, so the operator can find it in Tricount. */
function entryLabel(entry: Entry): string {
  return `Entry ${entry.id} ("${entry.description}", ${entry.date})`;
}

/** A Participant whose balance in the Trip would not match Tricount's. */
export type BalanceMismatch = { participant: Participant; imported: Rational; tricount: Rational };

/**
 * The Participants whose balance worked out by the domain package from `expenses` differs
 * from Tricount's by a cent (one minor unit) or more; empty when the import may land.
 */
export function balanceMismatches(
  trip: TripWithParticipants,
  expenses: readonly Expense[],
  tricountBalances: ReadonlyMap<string, bigint>,
): BalanceMismatch[] {
  const scale = 10n ** BigInt(minorUnits(trip.currency));
  const worked = balances({ ...trip, expenses, rates: [] });
  return trip.participants.flatMap((participant, index) => {
    const imported = worked[index]!.balance;
    const tricount = rational(tricountBalances.get(participant.id) ?? 0n, scale);
    const { numerator, denominator } = add(imported, negate(tricount));
    const differs = (numerator < 0n ? -numerator : numerator) * scale >= denominator;
    return differs ? [{ participant, imported, tricount }] : [];
  });
}
