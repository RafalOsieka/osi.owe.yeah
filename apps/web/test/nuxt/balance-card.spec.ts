import { rational, type ParticipantBalance } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import BalanceCard from '../../app/components/BalanceCard.vue';

const cents = (amount: bigint) => rational(amount, 100n);
const none = { amount: rational(0n), provisional: false };

/** The line under the balance on the card, every space read as a plain one. */
async function line(balance: ParticipantBalance) {
  const card = await mountSuspended(BalanceCard, {
    props: { balance, total: rational(0n), currency: 'EUR' },
  });
  return card.find('p.text-sm').text().replace(/\s/g, ' ');
}

describe('the balance card', () => {
  it('reads as what you paid and your share without Repayments, the share taking up the rounding', async () => {
    // A third of €10.00 that Kasia paid.
    const text = await line({
      participantId: 'kasia',
      paid: rational(10n),
      paidProvisional: false,
      share: rational(10n, 3n),
      balance: rational(20n, 3n),
      rounded: cents(667n),
      paidForExpenses: { amount: rational(10n), provisional: false },
      repaymentsMade: none,
      repaymentsReceived: none,
    });

    expect(text).toBe('You paid €10.00 · your share ≈ €3.33');
  });

  it('shows the Repayments handed to you apart from your Share of spending', async () => {
    // Bartek paid €252.03 of Expenses, his Share is €127.00, and he got €81.30 back.
    const text = await line({
      participantId: 'bartek',
      paid: cents(25203n),
      paidProvisional: false,
      share: cents(20830n),
      balance: cents(4373n),
      rounded: cents(4373n),
      paidForExpenses: { amount: cents(25203n), provisional: false },
      repaymentsMade: none,
      repaymentsReceived: { amount: cents(8130n), provisional: false },
    });

    expect(text).toBe('You paid €252.03 · your share €127.00 · repaid to you €81.30');
  });

  it('shows the Repayments you handed over beside what you paid', async () => {
    // Celina paid €91.20 of Expenses and repaid €31.30; her exact Share is a cent more than
    // what the rounded balance leaves.
    const text = await line({
      participantId: 'celina',
      paid: cents(12250n),
      paidProvisional: false,
      share: rational(122501n, 1000n),
      balance: rational(-1n, 1000n),
      rounded: rational(0n),
      paidForExpenses: { amount: cents(9120n), provisional: false },
      repaymentsMade: { amount: cents(3130n), provisional: false },
      repaymentsReceived: none,
    });

    expect(text).toBe('You paid €91.20 · you repaid €31.30 · your share ≈ €122.50');
  });
});
