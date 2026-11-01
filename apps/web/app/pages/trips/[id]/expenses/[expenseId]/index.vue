<script setup lang="ts">
import { expenseShares, type Rational } from '@osi/owe-yeah-domain';

// An Expense's detail page: the full title, total, when it was paid in its own zone, the
// Main payer, and each Participant's share; on top, why it is not synced yet if it isn't.
// Edit opens the Expense form.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim } = useOpenTrip();
const { t, locale } = useI18n();
const route = useRoute();

const expenseId = String(route.params.expenseId);
const expense = computed(() => trip.value.expenses.find(({ id }) => id === expenseId));
const tripPage = computed(() => `/trips/${trip.value.id}`);

const money = (amount: Rational) => formatMoney(amount, trip.value.currency, locale.value);

const details = computed(() => {
  if (!expense.value) return null;
  const { time, mainPayerId } = expense.value;
  const { total, shares } = expenseShares(expense.value);
  return {
    total,
    when: new Intl.DateTimeFormat(locale.value, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: time.zone,
    }).format(new Date(time.instant)),
    payer: trip.value.participants.find(({ id }) => id === mainPayerId),
    // In the Trip's order.
    shares: trip.value.participants.flatMap((participant) => {
      const share = shares.get(participant.id);
      return share ? [{ participant, share }] : [];
    }),
  };
});

// Why the Expense as shown hasn't reached the others yet.
const notSynced = computed(() => {
  const unsynced = expense.value?.unsynced;
  switch (unsynced?.status) {
    case undefined:
      return null;
    case 'pending':
      return { text: t('sync.pending'), color: 'neutral' } as const;
    case 'conflict':
      return { text: t('sync.conflict'), color: 'warning' } as const;
    case 'rejected': {
      const reason = unsynced.problems.map((problem) => t(`sync.reason.${problem}`)).join(' ');
      return { text: t('sync.rejected', { reason }), color: 'error' } as const;
    }
  }
});

useHead({ title: () => expense.value?.title ?? t('expense.notFound') });
</script>

<template>
  <NuxtLayout name="form" :title="expense?.title ?? ''" :parent="tripPage">
    <template v-if="expense" #actions>
      <UButton
        variant="ghost"
        :label="$t('expense.editShort')"
        :aria-label="$t('expense.edit')"
        :to="`/trips/${trip.id}/expenses/${expense.id}/edit`"
      />
    </template>

    <template v-if="expense && details">
      <UAlert
        v-if="notSynced"
        :title="notSynced.text"
        :color="notSynced.color"
        variant="subtle"
        icon="i-lucide-cloud-off"
        class="mb-4"
      />
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
    </template>
    <UEmpty v-else icon="i-lucide-receipt-text" variant="naked" :title="$t('expense.notFound')" />
  </NuxtLayout>
</template>
