<script setup lang="ts">
import { balances, isSettled, spendingTotal, suggestedRepayments } from '@osi/owe-yeah-domain';

// The Balances tab: your balance and your own Suggested Repayments ("To settle") first, then
// everyone's balance as diverging bars, the other Suggested Repayments (all of them without
// a Claim), Record another Repayment, and what the Trip spent. Once the Trip is Settled, "All
// settled" replaces the balance and the suggestions. Balances are worked out exactly and
// rounded with the largest remainder method, as settling up uses them.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim } = useOpenTrip();
const { locale } = useI18n();

const everyone = computed(() => balances(trip.value));
const settled = computed(() => isSettled(trip.value));
const mine = computed(
  () => everyone.value.find(({ participantId }) => participantId === claim.value?.id) ?? null,
);
const total = computed(() => spendingTotal(trip.value.expenses));

const suggestions = computed(() => {
  const all = suggestedRepayments(everyone.value);
  const claimId = claim.value?.id;
  const own = ({ payerId, recipientId }: (typeof all)[number]) =>
    payerId === claimId || recipientId === claimId;
  return { own: all.filter(own), others: all.filter((suggestion) => !own(suggestion)) };
});
</script>

<template>
  <NuxtLayout name="trip">
    <section
      v-if="settled"
      class="flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3.5 text-success"
    >
      <UIcon name="i-lucide-circle-check" class="size-8 shrink-0" />
      <div>
        <h2 class="text-xl font-bold">{{ $t('balances.allSettled') }}</h2>
        <p class="text-xs">{{ $t('balances.allSettledHelp') }}</p>
      </div>
    </section>
    <template v-else>
      <BalanceCard :balance="mine" :total="total" :currency="trip.currency" />

      <section v-if="suggestions.own.length > 0" aria-labelledby="to-settle-heading">
        <h2
          id="to-settle-heading"
          class="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase"
        >
          {{ $t('balances.toSettle') }}
        </h2>
        <SuggestedRepaymentList
          :suggestions="suggestions.own"
          :participants="trip.participants"
          :trip-id="trip.id"
          :currency="trip.currency"
          :claim-id="claim?.id"
        />
      </section>
    </template>

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

    <section v-if="!settled && suggestions.others.length > 0" aria-labelledby="suggestions-heading">
      <h2
        id="suggestions-heading"
        class="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase"
      >
        {{ claim ? $t('balances.otherSuggestions') : $t('balances.suggestions') }}
      </h2>
      <SuggestedRepaymentList
        :suggestions="suggestions.others"
        :participants="trip.participants"
        :trip-id="trip.id"
        :currency="trip.currency"
        :claim-id="claim?.id"
      />
    </section>

    <UButton
      variant="link"
      icon="i-lucide-plus"
      :label="$t('balances.recordAnother')"
      :to="`/trips/${trip.id}/repayments/new`"
      class="mt-3 px-0"
    />

    <p class="mt-4 text-xs text-muted">
      {{ $t('balances.tripTotalIs', { amount: formatMoney(total, trip.currency, locale) }) }}
    </p>
  </NuxtLayout>
</template>
