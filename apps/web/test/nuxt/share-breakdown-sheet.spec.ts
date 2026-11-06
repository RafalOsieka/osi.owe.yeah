import {
  rational,
  type Participant,
  type ParticipantBalance,
  type ShareBreakdown,
} from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import ShareBreakdownSheet from '../../app/components/ShareBreakdownSheet.vue';

const ania: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };

/**
 * Ania's balance from cents: what she paid towards Expenses, the Repayments she made and
 * received, and her rounded balance.
 */
function balanceOf({
  paid,
  paidProvisional = false,
  made = 0n,
  received = 0n,
  rounded,
}: {
  paid: bigint;
  paidProvisional?: boolean;
  made?: bigint;
  received?: bigint;
  rounded: bigint;
}): ParticipantBalance {
  const cents = (amount: bigint) => rational(amount, 100n);
  return {
    participantId: ania.id,
    paid: cents(paid + made),
    paidProvisional,
    share: cents(paid + made - rounded),
    balance: cents(rounded),
    rounded: cents(rounded),
    paidForExpenses: { amount: cents(paid), provisional: paidProvisional },
    repaymentsMade: { amount: cents(made), provisional: false },
    repaymentsReceived: { amount: cents(received), provisional: false },
  };
}

/** Ania's sheet as the Balances tab opens it: each row's label and amount, and its notes. */
async function sheet(breakdown: ShareBreakdown, balance: ParticipantBalance) {
  await mountSuspended(ShareBreakdownSheet, {
    props: { open: true, participant: ania, breakdown, currency: 'EUR', balance },
  });
  // "≈" keeps a no-break space after it; read every space as a plain one.
  const text = (cell: Element) => cell.textContent?.trim().replace(/\s/g, ' ');
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
      balanceOf({ paid: 900n, paidProvisional: true, rounded: 650n }),
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
      balanceOf({ paid: 0n, rounded: -333n }),
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

  it('lists the Repayments she received apart from her Share of spending, all adding up to her balance', async () => {
    const { rows } = await sheet(
      {
        share: rational(12700n, 100n),
        parts: [{ part: 'expenses', amount: rational(12700n, 100n), provisional: false }],
      },
      balanceOf({ paid: 25203n, received: 8130n, rounded: 4373n }),
    );

    expect(rows).toEqual([
      'Plain Expenses: €127.00',
      'Share: €127.00',
      'Paid: €252.03',
      'Repayments received: €81.30',
      'Ania is owed: €43.73',
    ]);
  });

  it('lists the Repayments she made beside what she paid towards Expenses', async () => {
    const { rows } = await sheet(
      {
        share: rational(12250n, 100n),
        parts: [{ part: 'expenses', amount: rational(12250n, 100n), provisional: false }],
      },
      balanceOf({ paid: 9120n, made: 3130n, rounded: 0n }),
    );

    expect(rows).toEqual([
      'Plain Expenses: €122.50',
      'Share: €122.50',
      'Paid: €91.20',
      'Repayments made: €31.30',
      'Ania is even: €0.00',
    ]);
  });
});
