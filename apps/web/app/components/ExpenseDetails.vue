<script setup lang="ts">
import { expenseShares, type Expense, type Rational } from '@osi/owe-yeah-domain';

// An Expense in full, as its detail page and an old Revision show it: the full title, total,
// when it was paid in its own zone, the Main payer, and each Participant's share, the claimed
// Participant's in bold.
const { expense } = defineProps<{ expense: Expense }>();

const { trip, claim } = useOpenTrip();
const { locale } = useI18n();

const money = (amount: Rational) => formatMoney(amount, expense.currency, locale.value);

const details = computed(() => {
  const { total, shares } = expenseShares(expense);
  return {
    total,
    when: formatExpenseTime(expense.time, locale.value),
    payer: trip.value.participants.find(({ id }) => id === expense.mainPayerId),
    // In the Trip's order.
    shares: trip.value.participants.flatMap((participant) => {
      const share = shares.get(participant.id);
      return share ? [{ participant, share }] : [];
    }),
  };
});
</script>

<template>
  <div>
    <p class="text-xl leading-tight font-bold wrap-anywhere">{{ expense.title }}</p>
    <p class="mt-0.5 text-3xl font-bold tabular-nums">{{ money(details.total) }}</p>
    <p class="text-sm text-muted">
      {{ $t('expense.timeInZone', { time: details.when, zone: expense.time.zone }) }}
    </p>

    <section aria-labelledby="paid-by-heading">
      <h2 id="paid-by-heading" class="mt-5 mb-1 text-xs font-semibold text-muted uppercase">
        {{ $t('expense.paidBy') }}
      </h2>
      <div v-if="details.payer" class="flex items-center gap-2.5 py-1.5">
        <ParticipantAvatar :participant="details.payer" />
        <span class="min-w-0 flex-1 truncate">{{ details.payer.name }}</span>
        <span class="shrink-0 tabular-nums">{{ money(details.total) }}</span>
      </div>
    </section>

    <section aria-labelledby="for-whom-heading">
      <h2 id="for-whom-heading" class="mt-5 mb-1 text-xs font-semibold text-muted uppercase">
        {{ $t('expense.forWhomEven') }}
      </h2>
      <ul>
        <li
          v-for="{ participant, share } in details.shares"
          :key="participant.id"
          class="flex items-center gap-2.5 py-1.5"
        >
          <ParticipantAvatar :participant="participant" />
          <span
            class="min-w-0 flex-1 truncate"
            :class="{ 'font-semibold': participant.id === claim?.id }"
          >
            {{ participant.name }}
          </span>
          <span class="shrink-0 tabular-nums">{{ money(share) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
