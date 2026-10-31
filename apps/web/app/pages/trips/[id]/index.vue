<script setup lang="ts">
import type { Expense, ExpenseChange, StoredExpense } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

// The Expenses tab: the Trip's Expenses, and the Expense form in a modal until it gets
// its own pages.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim, headers, refresh } = useOpenTrip();
const { t } = useI18n();

// The Expense form: `null` when closed, `{ expense: null }` for a new Expense.
const editing = ref<{ expense: StoredExpense | null } | null>(null);
const formOpen = computed({
  get: () => editing.value !== null,
  set: (open) => {
    if (!open) editing.value = null;
  },
});
useCloseOnBack(formOpen);
// Why the last save was refused, shown in the form; the Expense itself stays as it was.
const saveRefusals = ref<string[]>([]);
watch(editing, () => (saveRefusals.value = []));

const canAdd = computed(() => trip.value.participants.length > 0);

function addExpense(): void {
  editing.value = { expense: null };
}

// A resend of the very same change keeps its id, so a lost response is not applied twice.
let pendingChange: { key: string; id: string } | undefined;

function changeFor(expense: Expense, baseVersion: number | null): ExpenseChange {
  const key = JSON.stringify({ expense, baseVersion });
  if (pendingChange?.key !== key) pendingChange = { key, id: uuidv7() };
  return { id: pendingChange.id, baseVersion, expense };
}

// Sends the Expense's full new state through the sync push. Until the offline outbox
// arrives, this needs a connection.
async function saveExpense(expense: Expense): Promise<void> {
  saveRefusals.value = [];
  const change = changeFor(expense, editing.value?.expense?.version ?? null);
  const result = await $fetch(`/api/trips/${trip.value.id}/push`, {
    method: 'POST',
    headers,
    body: { changes: [change] },
  }).then(
    ({ results }) => results[0],
    () => null,
  );
  if (result === null) {
    saveRefusals.value = [t('expense.saveFailed')];
    return;
  }

  if (result?.status === 'accepted') {
    pendingChange = undefined;
    editing.value = null;
  } else if (result?.status === 'conflict') {
    saveRefusals.value = [t('expense.refused.conflict')];
  } else if (result?.status === 'rejected') {
    saveRefusals.value = result.problems.map((problem) => t(`expense.refused.${problem}`));
  }
  await refresh();
}
</script>

<template>
  <NuxtLayout name="trip">
    <ExpenseList
      v-if="trip.expenses.length > 0"
      :expenses="trip.expenses"
      :participants="trip.participants"
      @open="editing = { expense: $event }"
    />
    <UEmpty
      v-else
      icon="i-lucide-receipt-text"
      variant="naked"
      :title="$t('expense.empty')"
      :description="$t('expense.emptyHelp')"
      :actions="[
        {
          label: $t('expense.addFirst'),
          icon: 'i-lucide-plus',
          disabled: !canAdd,
          onClick: addExpense,
        },
      ]"
      class="pt-16"
    />

    <!-- Nearly the whole phone screen: a narrow gap around it, and less padding inside. -->
    <UModal
      v-model:open="formOpen"
      :title="editing?.expense ? $t('expense.edit') : $t('expense.new')"
      :ui="{
        content: 'w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)]',
        header: 'px-3 sm:px-6',
        body: 'p-3 sm:p-6',
      }"
    >
      <template #body>
        <ExpenseForm
          :trip="trip"
          :expense="editing?.expense"
          :claim-id="claim?.id"
          @submit="saveExpense"
        >
          <UAlert
            v-if="saveRefusals.length > 0"
            color="error"
            icon="i-lucide-circle-alert"
            :title="$t('expense.refused.title')"
            :description="saveRefusals.join(' ')"
          />
        </ExpenseForm>
      </template>
    </UModal>

    <!-- While the list is empty, the empty state offers the button instead. -->
    <template v-if="trip.expenses.length > 0" #action>
      <UButton
        icon="i-lucide-plus"
        :label="$t('expense.addShort')"
        :aria-label="$t('expense.add')"
        :disabled="!canAdd"
        size="xl"
        class="rounded-2xl shadow-lg"
        @click="addExpense"
      />
    </template>
  </NuxtLayout>
</template>
