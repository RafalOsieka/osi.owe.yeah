<script setup lang="ts">
import { expenseShares, type Expense, type Participant } from '@osi/owe-yeah-domain';

// One version of an Expense on the Conflict screen, as a card under `heading`: who made it
// (`authorId`, the Claim sent with the change, when known), whether it deletes the Expense,
// its title, total, when it was paid, who paid and who it is for.
const { expense, heading, deleted, authorId, participants } = defineProps<{
  expense: Expense;
  heading: string;
  deleted: boolean;
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
    income: total.numerator < 0n,
    // In the Trip's order.
    forWhom: new Intl.ListFormat(locale.value).format(
      participants.filter(({ id }) => shares.has(id)).map(({ name }) => name),
    ),
  };
});
</script>

<template>
  <section :aria-labelledby="headingId" class="rounded-lg border border-default p-3">
    <div class="flex items-center justify-between gap-2">
      <h2 :id="headingId" class="text-xs font-semibold text-muted uppercase">{{ heading }}</h2>
      <UBadge
        v-if="deleted"
        :label="$t('conflict.deleted')"
        color="error"
        variant="subtle"
        size="sm"
      />
    </div>
    <p v-if="shown.author" class="text-xs text-muted">
      {{ $t('conflict.by', { name: shown.author }) }}
    </p>
    <p class="mt-2 font-semibold wrap-anywhere">{{ expense.title }}</p>
    <p class="text-xl font-bold tabular-nums">{{ shown.total }}</p>
    <p class="text-sm text-muted">
      {{ $t('expense.timeInZone', { time: shown.when, zone: expense.time.zone }) }}
    </p>
    <p class="mt-2 text-sm">
      {{
        shown.income
          ? $t('conflict.receivedBy', { name: shown.payer })
          : $t('conflict.paidBy', { name: shown.payer })
      }}
    </p>
    <p class="text-sm wrap-anywhere">{{ $t('conflict.forWhom', { names: shown.forWhom }) }}</p>
  </section>
</template>
