<script setup lang="ts">
import { rational, type ParticipantBalance, type Rational } from '@osi/owe-yeah-domain';

// Your balance, first on the Balances tab: "You're owed X" (green), "You owe X" (red) or
// "You're even" (neutral), with what you paid and your share. Without a Claim it shows the
// Trip total instead. The balance shown is the rounded one settling up uses, so a fraction of
// a cent left over by an Even split doesn't read as owing.
const { balance, total, currency } = defineProps<{
  /** The claimed Participant's balance, or `null` without a Claim. */
  balance: ParticipantBalance | null;
  total: Rational;
  currency: string;
}>();

const { t, locale } = useI18n();

const money = (amount: Rational) => formatMoney(amount, currency, locale.value);

const card = computed(() => {
  if (!balance) {
    return { tone: 'bg-elevated', label: t('balances.tripTotal'), amount: money(total), sub: '' };
  }
  const { numerator, denominator } = balance.rounded;
  const sign = shownSign(balance.rounded, currency);
  const amount = money(rational(numerator < 0n ? -numerator : numerator, denominator));
  const sub = t('balances.paidAndShare', {
    paid: money(balance.paid),
    share: money(balance.share),
  });
  if (sign > 0) {
    return { tone: 'bg-success/10 text-success', label: t('balances.owed'), amount, sub };
  }
  if (sign < 0) return { tone: 'bg-error/10 text-error', label: t('balances.owe'), amount, sub };
  return { tone: 'bg-elevated', label: t('balances.even'), amount: '', sub };
});
</script>

<template>
  <section class="rounded-2xl px-4 py-3.5" :class="card.tone">
    <h2 class="text-sm">{{ card.label }}</h2>
    <p v-if="card.amount" class="text-3xl font-bold tabular-nums">{{ card.amount }}</p>
    <p v-if="card.sub" class="mt-0.5 text-xs">{{ card.sub }}</p>
  </section>
</template>
