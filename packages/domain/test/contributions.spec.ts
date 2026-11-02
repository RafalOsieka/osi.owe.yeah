import { describe, expect, it } from 'vite-plus/test';
import {
  balances,
  claimView,
  expenseProblems,
  rational,
  expenseSchema,
  type SplitExpense,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';

const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };
const ola = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Ola' };
const trip: TripWithParticipants = {
  id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia, ania, ola],
};

// Dinner for three at 60.00, paid by Kasia's card, with Ania leaving a 6.00 cash tip.
const dinner: SplitExpense = {
  id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
  title: 'Konoba Batelina',
  currency: 'EUR',
  time: { instant: '2026-07-14T19:30:00Z', zone: 'Europe/Zagreb' },
  mainPayerId: kasia.id,
  lineItems: [
    {
      name: '',
      unitPrice: 6000,
      quantity: 1,
      split: { mode: 'even', participantIds: [kasia.id, ania.id, ola.id] },
    },
  ],
  contributions: [{ participantId: ania.id, amount: 600 }],
};

describe('Contributions', () => {
  it('are kept on an Expense that fits its Trip', () => {
    expect(expenseSchema.parse(dinner)).toEqual(dinner);
    expect(expenseProblems(dinner, trip)).toEqual([]);
  });

  it('take one Contribution per Participant, of a positive amount', () => {
    const twice = {
      ...dinner,
      contributions: [...dinner.contributions!, ...dinner.contributions!],
    };
    expect(expenseSchema.safeParse(twice).success).toBe(false);
    const nothing = { ...dinner, contributions: [{ participantId: ania.id, amount: 0 }] };
    expect(expenseSchema.safeParse(nothing).success).toBe(false);
  });

  it('refuse one from the Main payer, or from someone not in the Trip', () => {
    const fromPayer = { ...dinner, contributions: [{ participantId: kasia.id, amount: 600 }] };
    expect(expenseProblems(fromPayer, trip)).toEqual(['contributionFromMainPayer']);
    const stranger = '019a2b3c-4d5e-7f00-8a1b-000000000099';
    const fromStranger = { ...dinner, contributions: [{ participantId: stranger, amount: 600 }] };
    expect(expenseProblems(fromStranger, trip)).toEqual(['unknownParticipant']);
  });

  it('count as paid by whoever made them, the Main payer paying the rest', () => {
    const paid = (expense: SplitExpense) =>
      balances({ ...trip, expenses: [expense], rates: [] }).map(({ paid }) => paid);
    expect(paid(dinner)).toEqual([rational(54n), rational(6n), rational(0n)]);

    // The bill turns out to be 75.00: the tip stays, Kasia's part grows.
    const repriced = { ...dinner, lineItems: [{ ...dinner.lineItems[0]!, unitPrice: 7500 }] };
    expect(paid(repriced)).toEqual([rational(69n), rational(6n), rational(0n)]);
  });

  it('show the claimed Participant what they lent or owe, Contributions included', () => {
    // Each share is 20.00: Kasia paid 54.00, Ania 6.00, and Ola nothing.
    expect(claimView(dinner, kasia.id)).toEqual({ kind: 'lent', amount: rational(34n) });
    expect(claimView(dinner, ania.id)).toEqual({ kind: 'share', amount: rational(14n) });
    expect(claimView(dinner, ola.id)).toEqual({ kind: 'share', amount: rational(20n) });

    // Ola tips 6.00 on a dinner for Kasia and Ania only: she lent all of it.
    const forTwo = {
      ...dinner,
      lineItems: [
        { ...dinner.lineItems[0]!, split: { mode: 'even', participantIds: [kasia.id, ania.id] } },
      ],
      contributions: [{ participantId: ola.id, amount: 600 }],
    } satisfies SplitExpense;
    expect(claimView(forTwo, ola.id)).toEqual({ kind: 'lent', amount: rational(6n) });
  });

  it('may cover the whole total, but not more, so Income has none', () => {
    const whole = {
      ...dinner,
      contributions: [
        { participantId: ania.id, amount: 4000 },
        { participantId: ola.id, amount: 2000 },
      ],
    };
    expect(expenseProblems(whole, trip)).toEqual([]);
    const more = { ...dinner, contributions: [{ participantId: ania.id, amount: 6001 }] };
    expect(expenseProblems(more, trip)).toEqual(['contributionsExceedTotal']);
    const income = { ...dinner, lineItems: [{ ...dinner.lineItems[0]!, unitPrice: -6000 }] };
    expect(expenseProblems(income, trip)).toEqual(['contributionsExceedTotal']);
  });
});
