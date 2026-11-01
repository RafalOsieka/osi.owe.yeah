<script setup lang="ts">
import { add, balances, expenseShares, rational } from '@osi/owe-yeah-domain';

// The Balances tab: your balance first, then everyone's as diverging bars, and the Trip
// total. Worked out exactly and rounded only for display ("≈" marks amounts rounding changed).
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim } = useOpenTrip();
const { locale } = useI18n();

const everyone = computed(() => balances(trip.value));
const mine = computed(
  () => everyone.value.find(({ participantId }) => participantId === claim.value?.id) ?? null,
);
const total = computed(() =>
  trip.value.expenses.reduce(
    (sum, expense) => add(sum, expenseShares(expense).total),
    rational(0n),
  ),
);
</script>

<template>
  <NuxtLayout name="trip">
    <BalanceCard :balance="mine" :total="total" :currency="trip.currency" />

    <section aria-labelledby="everyone-heading">
      <h2
        id="everyone-heading"
        class="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase"
      >
        {{ $t('balances.everyone') }}
      </h2>
      <BalanceBars
        :balances="everyone"
        :participants="trip.participants"
        :currency="trip.currency"
        :claim-id="claim?.id"
      />
    </section>

    <p class="mt-4 text-xs text-muted">
      {{ $t('balances.tripTotalIs', { amount: formatMoney(total, trip.currency, locale) }) }}
    </p>
  </NuxtLayout>
</template>
