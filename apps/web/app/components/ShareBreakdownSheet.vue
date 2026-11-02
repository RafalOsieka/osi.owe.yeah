<script setup lang="ts">
import {
  roundMoney,
  type Participant,
  type Rational,
  type ShareBreakdown,
} from '@osi/owe-yeah-domain';

// Where a Participant's share comes from, as a sheet: each part of it (goods, discounts,
// Deposits, Deposit refunds, what is not assigned yet, and on the Balances tab plain
// Expenses, Income and Repayments received), then the share itself. Opened from a share on
// a Receipt, or with what they paid and their balance from their bar on the Balances tab.
// Amounts stay exact and are only rounded to show them, "≈" marking those rounding changed,
// so the rounded parts may not add up to the rounded share; a note says so when it applies.
const {
  breakdown,
  currency,
  paid = null,
  balance = null,
} = defineProps<{
  participant: Participant;
  breakdown: ShareBreakdown;
  currency: string;
  /** What they paid, on the Balances tab. */
  paid?: Rational | null;
  /** Their rounded balance, as their bar shows it, on the Balances tab. */
  balance?: Rational | null;
}>();
const open = defineModel<boolean>('open', { required: true });

const { locale } = useI18n();

const money = (amount: Rational) => formatMoney(amount, currency, locale.value);
const rounded = computed(() =>
  [breakdown.share, paid, ...breakdown.parts.map(({ amount }) => amount)].some(
    (amount) => amount && !roundMoney(amount, currency).exact,
  ),
);
</script>

<template>
  <UDrawer v-model:open="open" :title="$t('breakdown.title', { name: participant.name })">
    <template #body>
      <dl class="tabular-nums">
        <div v-if="paid" class="flex justify-between gap-2 py-1.5">
          <dt>{{ $t('breakdown.paid') }}</dt>
          <dd>{{ money(paid) }}</dd>
        </div>
        <div
          v-for="{ part, amount } in breakdown.parts"
          :key="part"
          class="flex justify-between gap-2 py-1.5 text-sm text-muted"
        >
          <dt>{{ $t(`breakdown.part.${part}`) }}</dt>
          <dd>{{ formatMoney(amount, currency, locale, 'signedCurrency') }}</dd>
        </div>
        <div class="flex justify-between gap-2 border-t border-default py-1.5 font-semibold">
          <dt>{{ $t('breakdown.share') }}</dt>
          <dd>{{ money(breakdown.share) }}</dd>
        </div>
        <div v-if="balance" class="flex justify-between gap-2 py-1.5">
          <dt>{{ $t('breakdown.balance') }}</dt>
          <dd>{{ formatMoney(balance, currency, locale, 'signedCurrency') }}</dd>
        </div>
      </dl>
      <p v-if="rounded" class="mt-3 text-xs text-muted">{{ $t('breakdown.rounded') }}</p>
    </template>
  </UDrawer>
</template>
