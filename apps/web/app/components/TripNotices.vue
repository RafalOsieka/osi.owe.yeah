<script setup lang="ts">
import { referencedParticipantIds, type Participant } from '@osi/owe-yeah-domain';
import type { Notice } from '~/sync/db';
import type { LocalExpense } from '~/sync/local-trip';

// What sync has to tell about this device's changes, on top of every Trip tab until
// dismissed: a removed Participant one of its Expenses brought back, or a removal the server
// refused because an Expense includes them now. Each says what happened and, when one Expense
// explains it, offers "Show Expense". Neutral cards like the rest of the page: nothing is
// wrong, it only changed. A removed Claim is told in "Who are you?" instead.
const { trip, notices, dismissNotice } = useOpenTrip();
const { t } = useI18n();

// The Trip's Expenses that include `participant`, optionally only those titled `title`.
const including = (participant: Participant, title?: string) =>
  trip.value.expenses.filter(
    (expense) =>
      referencedParticipantIds(expense).has(participant.id) &&
      (title === undefined || expense.title === title),
  );

const shown = computed(() =>
  notices.value.flatMap((notice) => {
    if (notice.kind === 'claimRemoved') return [];
    const expenses =
      notice.kind === 'participantRestored'
        ? including(notice.participant, notice.expenseTitle)
        : including(notice.participant);
    const only = expenses.length === 1 ? expenses[0] : undefined;
    return [{ id: notice.id, text: text(notice, only), expense: only ?? null }];
  }),
);

// What a notice says; a refused removal names the Expense when only one includes them.
function text(notice: Exclude<Notice, { kind: 'claimRemoved' }>, only?: LocalExpense): string {
  const name = notice.participant.name;
  if (notice.kind === 'participantRestored') {
    return t('notices.participantRestored', { name, title: notice.expenseTitle });
  }
  return only
    ? t('notices.removalRefusedBy', { name, title: only.title })
    : t('notices.removalRefused', { name });
}
</script>

<template>
  <ul v-if="shown.length > 0" class="mb-4 space-y-2">
    <li v-for="notice in shown" :key="notice.id" class="card flex items-start gap-3 py-3 ps-4 pe-2">
      <UIcon name="i-lucide-info" class="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
      <div class="min-w-0 flex-1 pt-px">
        <p class="text-sm text-default">{{ notice.text }}</p>
        <UButton
          v-if="notice.expense"
          :to="`/trips/${trip.id}/expenses/${notice.expense.id}`"
          variant="link"
          trailing-icon="i-lucide-chevron-right"
          :label="$t('notices.showExpense')"
          class="-ms-3.5 -mb-2"
        />
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        class="-my-1 text-dimmed"
        :aria-label="$t('form.close')"
        @click="dismissNotice(notice.id)"
      />
    </li>
  </ul>
</template>
