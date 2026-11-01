<script setup lang="ts">
import { expenseShares, type Expense, type Participant } from '@osi/owe-yeah-domain';

// One version of an Expense on the Conflict screen, as a card under `heading`: who made it
// (`authorId`, the Claim sent with the change, when known), its title, total, when it was
// paid, who paid and who it is for.
const { expense, heading, authorId, participants } = defineProps<{
  expense: Expense;
  heading: string;
  authorId: string | null;
  participants: readonly Participant[];
}>();

const { locale } = useI18n();
const headingId = useId();

const nameOf = (id: string) => participants.find((participant) => participant.id === id)?.name;

const shown = computed(() => {
  const { total, shares } = expenseShares(expense);
  return {
    author: authorId === null ? undefined : nameOf(authorId),
    total: formatMoney(total, expense.currency, locale.value),
    when: formatExpenseTime(expense.time, locale.value),
    payer: nameOf(expense.mainPayerId) ?? '?',
    // In the Trip's order.
    forWhom: new Intl.ListFormat(locale.value).format(
      participants.filter(({ id }) => shares.has(id)).map(({ name }) => name),
    ),
  };
});
</script>

<template>
  <section :aria-labelledby="headingId" class="rounded-lg border border-default p-3">
    <h2 :id="headingId" class="text-xs font-semibold text-muted uppercase">{{ heading }}</h2>
    <p v-if="shown.author" class="text-xs text-muted">
      {{ $t('conflict.by', { name: shown.author }) }}
    </p>
    <p class="mt-2 font-semibold wrap-anywhere">{{ expense.title }}</p>
    <p class="text-xl font-bold tabular-nums">{{ shown.total }}</p>
    <p class="text-sm text-muted">
      {{ $t('expense.timeInZone', { time: shown.when, zone: expense.time.zone }) }}
    </p>
    <p class="mt-2 text-sm">{{ $t('conflict.paidFor', { name: shown.payer }) }}</p>
    <p class="text-sm wrap-anywhere">{{ $t('conflict.forWhom', { names: shown.forWhom }) }}</p>
  </section>
</template>
