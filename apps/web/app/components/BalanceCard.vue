<script setup lang="ts">
import {
  compare,
  rational,
  subtract,
  type ParticipantBalance,
  type Rational,
} from '@osi/owe-yeah-domain';

// Your balance, first on the Balances tab: "You're owed X" (green), "You owe X" (red) or
// "You're even" (neutral), told by the icon (← owing, → owed, as the bars below point), with
// what you paid towards Expenses and your Share of spending, and the Repayments you made
// (beside what you paid) and received (after your share), each only when not zero. The balance
// shown is the rounded one settling up uses, so a fraction of a cent left over by an Even split
// doesn't read as owing, and the share shown is what is left once it is taken from the rest, so
// the card adds up. Without a Claim it shows the Trip total instead. The default slot sits under
// a line at the bottom, for what settles it.
const { balance, total, currency } = defineProps<{
  /** The claimed Participant's balance, or `null` without a Claim. */
  balance: ParticipantBalance | null;
  total: Rational;
  currency: string;
}>();

const { t, locale } = useI18n();

const money = (amount: Rational) => formatMoney(amount, currency, locale.value);

const tones = {
  owed: { icon: 'i-lucide-arrow-right', chip: 'bg-success/12 text-success' },
  owe: { icon: 'i-lucide-arrow-left', chip: 'bg-error/12 text-error' },
  even: { icon: 'i-lucide-equal', chip: 'bg-elevated text-muted' },
  total: { icon: 'i-lucide-wallet', chip: 'bg-primary/12 text-primary' },
};

const card = computed(() => {
  if (!balance) {
    return { ...tones.total, label: t('balances.tripTotal'), amount: money(total), sub: '' };
  }
  const { numerator, denominator } = balance.rounded;
  const sign = shownSign(balance.rounded, currency);
  const amount = money(rational(numerator < 0n ? -numerator : numerator, denominator));
  const { paidForExpenses, repaymentsMade, repaymentsReceived } = balance;
  // The Share of spending as what is left once the rounded balance is taken from the rest, so
  // the amounts on the card add up; "≈" while it differs from the exact Share of spending.
  const spent = subtract(balance.share, repaymentsReceived.amount);
  const shown = subtract(subtract(balance.paid, repaymentsReceived.amount), balance.rounded);
  const share = formatMoney(shown, currency, locale.value, 'currency', compare(shown, spent) !== 0);
  // The line's segments, each kept whole (no-break spaces) when it wraps.
  const sub = [
    t('balances.youPaid', { amount: money(paidForExpenses.amount) }),
    ...(repaymentsMade.amount.numerator !== 0n
      ? [t('balances.youRepaid', { amount: money(repaymentsMade.amount) })]
      : []),
    t('balances.yourShare', { amount: share }),
    ...(repaymentsReceived.amount.numerator !== 0n
      ? [t('balances.repaidToYou', { amount: money(repaymentsReceived.amount) })]
      : []),
  ]
    .map((segment) => segment.replaceAll(' ', '\u00a0'))
    .join(' · ');
  if (sign > 0) return { ...tones.owed, label: t('balances.owed'), amount, sub };
  if (sign < 0) return { ...tones.owe, label: t('balances.owe'), amount, sub };
  return { ...tones.even, label: t('balances.even'), amount: '', sub };
});
</script>

<template>
  <section class="card overflow-hidden p-5">
    <h2 class="flex items-center gap-2 text-sm font-medium text-toned">
      <span class="grid size-6 place-items-center rounded-full" :class="card.chip">
        <UIcon :name="card.icon" class="size-3.5" />
      </span>
      {{ card.label }}
    </h2>
    <p
      v-if="card.amount"
      class="mt-3 text-[2.75rem] leading-none font-semibold tracking-tight text-highlighted tabular-nums"
    >
      {{ card.amount }}
    </p>
    <p v-if="card.sub" class="mt-3 text-sm text-muted tabular-nums">{{ card.sub }}</p>
    <div v-if="$slots.default" class="-mx-5 mt-5 -mb-5 border-t border-default">
      <slot />
    </div>
  </section>
</template>
