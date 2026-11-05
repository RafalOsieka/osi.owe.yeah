<script setup lang="ts">
import { rational, type ParticipantBalance, type Rational } from '@osi/owe-yeah-domain';

// Your balance, first on the Balances tab: "You're owed X" (green), "You owe X" (red) or
// "You're even" (neutral), told by the icon and glow, with what you paid and your share. Without a Claim it shows the
// Trip total instead. The default slot sits under a line at the bottom, for what settles it. The balance shown is the rounded one settling up uses, so a fraction of
// a cent left over by an Even split doesn't read as owing.
const { balance, total, currency } = defineProps<{
  /** The claimed Participant's balance, or `null` without a Claim. */
  balance: ParticipantBalance | null;
  total: Rational;
  currency: string;
}>();

const { t, locale } = useI18n();

const money = (amount: Rational) => formatMoney(amount, currency, locale.value);

const tones = {
  owed: {
    icon: 'i-lucide-arrow-down-left',
    chip: 'bg-success/12 text-success',
    glow: 'bg-success/25',
  },
  owe: { icon: 'i-lucide-arrow-up-right', chip: 'bg-error/12 text-error', glow: 'bg-error/20' },
  even: { icon: 'i-lucide-equal', chip: 'bg-elevated text-muted', glow: 'bg-transparent' },
  total: { icon: 'i-lucide-wallet', chip: 'bg-primary/12 text-primary', glow: 'bg-primary/15' },
};

const card = computed(() => {
  if (!balance) {
    return { ...tones.total, label: t('balances.tripTotal'), amount: money(total), sub: '' };
  }
  const { numerator, denominator } = balance.rounded;
  const sign = shownSign(balance.rounded, currency);
  const amount = money(rational(numerator < 0n ? -numerator : numerator, denominator));
  const sub = t('balances.paidAndShare', {
    paid: money(balance.paid),
    share: money(balance.share),
  });
  if (sign > 0) return { ...tones.owed, label: t('balances.owed'), amount, sub };
  if (sign < 0) return { ...tones.owe, label: t('balances.owe'), amount, sub };
  return { ...tones.even, label: t('balances.even'), amount: '', sub };
});
</script>

<template>
  <section class="card relative overflow-hidden p-5">
    <div
      class="pointer-events-none absolute -end-12 -top-20 size-56 rounded-full blur-3xl"
      :class="card.glow"
      aria-hidden="true"
    />
    <h2 class="relative flex items-center gap-2 text-sm font-medium text-toned">
      <span class="grid size-6 place-items-center rounded-full" :class="card.chip">
        <UIcon :name="card.icon" class="size-3.5" />
      </span>
      {{ card.label }}
    </h2>
    <p
      v-if="card.amount"
      class="relative mt-3 text-[2.75rem] leading-none font-semibold tracking-tight text-highlighted tabular-nums"
    >
      {{ card.amount }}
    </p>
    <p v-if="card.sub" class="relative mt-3 text-sm text-muted tabular-nums">{{ card.sub }}</p>
    <div v-if="$slots.default" class="relative -mx-5 mt-5 -mb-5 border-t border-default">
      <slot />
    </div>
  </section>
</template>
