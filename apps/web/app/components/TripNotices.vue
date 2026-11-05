<script setup lang="ts">
import { referencedParticipantIds, type Participant } from '@osi/owe-yeah-domain';

// What sync has to tell about this device's changes, on top of every Trip tab until
// dismissed: a removed Participant one of its Expenses brought back, or a removal the server
// refused because an Expense includes them now. Each says what happened and, when one Expense
// explains it, offers "Show Expense". An outlined note on the canvas, so it doesn't read as one
// of the Expenses: nothing is wrong, it only changed. A quoted title never breaks mid-quote.
// A removed Claim is told in "Who are you?" instead.
const { trip, notices, dismissNotice } = useOpenTrip();

// The Trip's Expenses that include `participant`, optionally only those titled `title`.
const including = (participant: Participant, title?: string) =>
  trip.value.expenses.filter(
    (expense) =>
      referencedParticipantIds(expense).has(participant.id) &&
      (title === undefined || expense.title === title),
  );

// Each notice as its message key and what it names; a refused removal names the Expense
// when only one includes them.
const shown = computed(() =>
  notices.value.flatMap((notice) => {
    if (notice.kind === 'claimRemoved') return [];
    const restored = notice.kind === 'participantRestored';
    const expenses = restored
      ? including(notice.participant, notice.expenseTitle)
      : including(notice.participant);
    const only = expenses.length === 1 ? expenses[0] : undefined;
    const title = restored ? notice.expenseTitle : (only?.title ?? null);
    const keypath = restored
      ? 'notices.participantRestored'
      : only
        ? 'notices.removalRefusedBy'
        : 'notices.removalRefused';
    return [
      { id: notice.id, keypath, name: notice.participant.name, title, expense: only ?? null },
    ];
  }),
);
</script>

<template>
  <ul v-if="shown.length > 0" class="mb-4 space-y-2">
    <li
      v-for="notice in shown"
      :key="notice.id"
      class="flex items-start gap-3 rounded-xl py-3 ps-4 pe-2 ring-1 ring-accented ring-inset"
    >
      <UIcon name="i-lucide-info" class="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
      <div class="min-w-0 flex-1 pt-px">
        <i18n-t :keypath="notice.keypath" tag="p" scope="global" class="text-sm text-default">
          <template #name>{{ notice.name }}</template>
          <template #title>
            <span class="inline-block max-w-full truncate align-bottom whitespace-nowrap">
              {{ $t('notices.quoted', { title: notice.title }) }}
            </span>
          </template>
        </i18n-t>
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
