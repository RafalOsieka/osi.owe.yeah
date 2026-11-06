import { rational, type Participant, type ShareBreakdown } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import ShareBreakdownSheet from '../../app/components/ShareBreakdownSheet.vue';

const ania: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };

/** Ania's sheet as the Balances tab opens it: each row's label and amount, and its notes. */
async function sheet(
  breakdown: ShareBreakdown,
  { paid, paidProvisional, balance }: { paid: bigint; paidProvisional: boolean; balance: bigint },
) {
  await mountSuspended(ShareBreakdownSheet, {
    props: {
      open: true,
      participant: ania,
      breakdown,
      currency: 'EUR',
      paid: rational(paid, 100n),
      paidProvisional,
      balance: rational(balance, 100n),
    },
  });
  // '≈' keeps a no-break space after it; read it as a plain one.
  const text = (cell: Element) => cell.textContent?.trim().replaceAll(' ', ' ');
  const rows = [...document.body.querySelectorAll('dl > div')].map((row) =>
    [...row.children].map(text).join(': '),
  );
  const notes = [...document.body.querySelectorAll('dl ~ p')].map((note) => note.textContent);
  return { rows, notes: notes.join(' ') };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the share breakdown sheet', () => {
  it('marks what includes a Provisional-rate amount with "≈", and says the rate is provisional', async () => {
    // Her half of a taxi converted at a Provisional rate, less her half of Income in EUR.
    const { rows, notes } = await sheet(
      {
        share: rational(250n, 100n),
        parts: [
          { part: 'expenses', amount: rational(450n, 100n), provisional: true },
          { part: 'income', amount: rational(-200n, 100n), provisional: false },
        ],
      },
      { paid: 900n, paidProvisional: true, balance: 650n },
    );

    expect(rows).toEqual([
      'Plain Expenses: ≈ €4.50',
      'Income: −€2.00',
      'Share: ≈ €2.50',
      'Paid: ≈ €9.00',
      'Ania is owed: ≈ €6.50',
    ]);
    expect(notes).toContain('Provisional rate');
    expect(notes).not.toContain('rounded');
  });

  it('keeps parts that are only rounded without "≈"', async () => {
    // A third of €10.00, at no Provisional rate.
    const { rows, notes } = await sheet(
      {
        share: rational(10n, 3n),
        parts: [{ part: 'expenses', amount: rational(10n, 3n), provisional: false }],
      },
      { paid: 0n, paidProvisional: false, balance: -333n },
    );

    expect(rows).toEqual([
      'Plain Expenses: €3.33',
      'Share: ≈ €3.33',
      'Paid: €0.00',
      'Ania owes: €3.33',
    ]);
    expect(notes).toContain('rounded');
    expect(notes).not.toContain('Provisional rate');
  });
});
