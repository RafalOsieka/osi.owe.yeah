import { describe, expect, it } from 'vite-plus/test';
import { expensesReferencing, type Expense } from '@osi/owe-yeah-domain';

const kasia = '019a2b3c-4d5e-7f00-8a1b-000000000001';
const ania = '019a2b3c-4d5e-7f00-8a1b-000000000002';
const ola = '019a2b3c-4d5e-7f00-8a1b-000000000003';
const bartek = '019a2b3c-4d5e-7f00-8a1b-000000000004';

const base = {
  currency: 'EUR',
  time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
} as const;

const lidl: Expense = {
  ...base,
  id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
  title: 'Lidl Rovinj',
  mainPayerId: kasia,
  lineItems: [
    {
      name: 'Water',
      unitPrice: 90,
      quantity: 3,
      split: { mode: 'units', parts: [{ participantId: ania, units: 3 }] },
    },
  ],
  contributions: [{ participantId: ola, amount: 100 }],
};

const repayment: Expense = {
  ...base,
  id: '019a2b3c-4d5e-7f00-8a1b-0000000000e5',
  title: 'Repayment',
  mainPayerId: bartek,
  recipientId: kasia,
  amount: 1225,
};

describe('expensesReferencing', () => {
  it('counts the Expenses a Participant pays, shares, contributes to or receives', () => {
    const expenses = [lidl, repayment];

    expect(expensesReferencing(expenses, kasia)).toBe(2);
    expect(expensesReferencing(expenses, ania)).toBe(1);
    expect(expensesReferencing(expenses, ola)).toBe(1);
    expect(expensesReferencing(expenses, bartek)).toBe(1);
    expect(expensesReferencing(expenses, '019a2b3c-4d5e-7f00-8a1b-000000000009')).toBe(0);
  });
});
