import { readFileSync } from 'node:fs';
import { isRepayment, type Expense } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vite-plus/test';
import { balanceMismatches, importTricount } from '../src/mapping.ts';
import { parseTricount } from '../src/tricount.ts';

// An anonymised saved response of `GET /v1/user/{id}/registry`: three active members, one
// deleted member nobody references any more and one who is still on an Expense.
const saved = readFileSync(new URL('./fixtures/tricount-response.json', import.meta.url), 'utf8');

const byTitle = (expenses: readonly Expense[], title: string) =>
  expenses.find((expense) => expense.title === title)!;

describe('importTricount', () => {
  it('maps a saved Tricount to a Trip whose balances match Tricount', () => {
    const { trip, expenses, tricountBalances, skipped } = importTricount(
      parseTricount(saved),
      'Europe/Zagreb',
    );
    const name = new Map(trip.participants.map(({ id, name }) => [id, name]));
    const named = (id: string) => name.get(id);

    expect(trip).toMatchObject({ name: 'Croatia 2026', currency: 'EUR' });
    expect(trip.participants.map(({ name }) => name)).toEqual(['Ania', 'Kasia', 'Bartek', 'Gone']);
    // Worked out by hand from the fixture's allocations.
    expect(
      Object.fromEntries([...tricountBalances].map(([id, minor]) => [named(id), minor])),
    ).toEqual({ Ania: 2066n, Kasia: -3133n, Bartek: 1567n, Gone: -500n });
    expect(skipped).toBe(1);

    const groceries = byTitle(expenses, 'Groceries');
    expect(groceries.time).toEqual({ instant: '2026-07-14T17:30:00Z', zone: 'Europe/Zagreb' });
    expect(groceries).toMatchObject({ currency: 'EUR', lineItems: [{ unitPrice: 3000 }] });
    expect(groceries.manualRate).toBeUndefined();
    expect(isRepayment(groceries) ? null : groceries.lineItems[0]!.split.mode).toBe('even');

    // Equal ratios that don't divide to the cent keep Tricount's stored allocations.
    expect(byTitle(expenses, 'Ice cream')).toMatchObject({
      lineItems: [
        { split: { mode: 'amounts', parts: [{ amount: 334 }, { amount: 333 }, { amount: 333 }] } },
      ],
    });
    const taxi = byTitle(expenses, 'Taxi');
    expect(taxi).toMatchObject({ lineItems: [{ split: { mode: 'amounts' } }] });
    expect(isRepayment(taxi) ? [] : taxi.lineItems[0]!.split).toMatchObject({
      parts: [{ amount: 500 }, { amount: 1500 }],
    });

    const tickets = byTitle(expenses, 'Castle tickets');
    expect(tickets).toMatchObject({
      currency: 'CZK',
      manualRate: { kind: 'charged', amount: 1000, currency: 'EUR' },
      lineItems: [{ unitPrice: 25000, split: { mode: 'even' } }],
    });
    expect(isRepayment(tickets) ? [] : tickets.lineItems[0]!.split).toMatchObject({
      participantIds: [expect.any(String), expect.any(String)],
    });

    expect(byTitle(expenses, 'Deposit back')).toMatchObject({
      lineItems: [{ unitPrice: -1200, split: { mode: 'even' } }],
    });
    const paidBack = byTitle(expenses, 'Paid back');
    expect(
      isRepayment(paidBack) && [named(paidBack.mainPayerId), named(paidBack.recipientId)],
    ).toEqual(['Bartek', 'Ania']);
    expect(paidBack).toMatchObject({ amount: 500 });

    expect(balanceMismatches(trip, expenses, tricountBalances)).toEqual([]);
  });

  it('reports the Participants whose balance would differ from Tricount by a cent or more', () => {
    const registry = parseTricount(saved);
    // The tickets' Czech crowns split 100 / 150, while Tricount's euros split 5.00 / 5.00.
    const tickets = registry.entries.find(({ description }) => description === 'Castle tickets')!;
    tickets.allocations[0]!.amountLocal = { value: '-100.00', currency: 'CZK' };
    tickets.allocations[1]!.amountLocal = { value: '-150.00', currency: 'CZK' };

    const { trip, expenses, tricountBalances } = importTricount(registry, 'Europe/Zagreb');
    const mismatches = balanceMismatches(trip, expenses, tricountBalances);

    expect(mismatches.map(({ participant }) => participant.name)).toEqual(['Kasia', 'Gone']);
  });
});
