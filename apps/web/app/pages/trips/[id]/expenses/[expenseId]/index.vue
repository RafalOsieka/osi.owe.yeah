<script setup lang="ts">
import type { AlertProps } from '@nuxt/ui';
import { isRepayment } from '@osi/owe-yeah-domain';
import { toExpense } from '~/sync/local-trip';

// An Expense's detail page: the Expense in full, with its total converted into the Trip
// currency; on top, why it is not synced yet if it
// isn't; at the bottom, who last edited it and when, its History, and Delete. A Conflict
// opens the Conflict screen; a rejected change is fixed with Edit or discarded. Edit opens the
// Expense form. Delete moves it to Recently deleted, with Undo for a moment. Should the
// Expense go (deleted, or a discarded new one), so does the page.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, everyone, discardChanges, deleteExpense, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const toast = useToast();
const route = useRoute();
const back = useBack();

const expenseId = String(route.params.expenseId);
const expense = computed(() => trip.value.expenses.find(({ id }) => id === expenseId));
const tripPage = computed(() => `/trips/${trip.value.id}`);
const page = computed(() => `${tripPage.value}/expenses/${expenseId}`);

watch(expense, (now, before) => {
  if (before && !now) void back(tripPage.value);
});

// "Last edited by Kasia, 2 hr. ago", by the server's clock once it has the change.
const lastEdited = computed(() => {
  const edited = expense.value?.edited;
  if (!edited) return null;
  const name = everyone.value.find(({ id }) => id === edited.by)?.name;
  const when = edited.at
    ? formatTimeAgo(edited.at, new Date(), locale.value)
    : t('history.notSyncedYet');
  return name ? t('history.lastEditedBy', { name, when }) : t('history.lastEdited', { when });
});

// Which Trip rules the last delete broke; the Expense stays as it was.
const refusals = ref<string[]>([]);

async function remove(): Promise<void> {
  if (!expense.value) return;
  const deleted = toExpense(expense.value);
  const refused = await deleteExpense(deleted, expense.value);
  refusals.value = refused.map((problem) => t(`expense.refused.${problem}`));
  if (refused.length > 0) return;
  toast.add({
    title: t('expense.deleted', { title: deleted.title }),
    actions: [{ label: t('expense.undo'), onClick: () => void restore(deleted.id) }],
  });
}

// Undo: the deleted Expense saved again, on top of its deletion.
async function restore(deletedId: string): Promise<void> {
  const deleted = trip.value.deletedExpenses.find(({ id }) => id === deletedId);
  if (deleted) await saveExpense(toExpense(deleted), deleted);
}

// Why the Expense as shown hasn't reached the others yet, and what can be done about it.
const notSynced = computed((): AlertProps | null => {
  const unsynced = expense.value?.unsynced;
  switch (unsynced?.status) {
    case undefined:
      return null;
    case 'pending':
      return { title: t('sync.pending'), color: 'neutral', icon: 'i-lucide-cloud-off' };
    case 'conflict': {
      const author = trip.value.participants.find(({ id }) => id === unsynced.currentClaimId);
      return {
        title: author ? t('sync.conflictBy', { name: author.name }) : t('sync.conflictBySomeone'),
        color: 'error',
        icon: 'i-lucide-triangle-alert',
        actions: [{ label: t('sync.choose'), to: `${page.value}/conflict` }],
      };
    }
    case 'rejected': {
      const reason = unsynced.problems.map((problem) => t(`sync.reason.${problem}`)).join(' ');
      return {
        title: t('sync.rejected', { reason }),
        description: t('sync.rejectedHelp'),
        color: 'error',
        icon: 'i-lucide-cloud-off',
        actions: [{ label: t('sync.discard'), onClick: () => discardChanges(expenseId) }],
      };
    }
  }
});

useHead({ title: () => expense.value?.title ?? t('expense.notFound') });
</script>

<template>
  <NuxtLayout name="form" :title="expense?.title ?? ''" :parent="tripPage" title-hidden>
    <template v-if="expense" #actions>
      <UButton
        variant="soft"
        icon="i-lucide-pencil"
        :label="$t('expense.editShort')"
        :aria-label="isRepayment(expense) ? $t('repayment.edit') : $t('expense.edit')"
        :to="`/trips/${trip.id}/expenses/${expense.id}/edit`"
      />
    </template>

    <template v-if="expense">
      <UAlert v-if="notSynced" v-bind="notSynced" variant="subtle" class="mb-4" />
      <ExpenseDetails :expense="expense" converted />

      <footer class="mt-7">
        <div class="card overflow-hidden">
          <NuxtLink
            :to="`${page}/history`"
            class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/60"
          >
            <UIcon name="i-lucide-history" class="size-5 shrink-0 text-muted" />
            <span class="min-w-0 flex-1">
              <span class="block text-highlighted">{{ $t('history.title') }}</span>
              <span v-if="lastEdited" class="block text-sm text-muted">{{ lastEdited }}</span>
            </span>
            <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
          </NuxtLink>
        </div>
        <div class="card mt-4 overflow-hidden">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start font-medium text-error transition-colors hover:bg-error/5"
            @click="remove"
          >
            <UIcon name="i-lucide-trash-2" class="size-5 shrink-0" />
            {{ $t('expense.delete') }}
          </button>
        </div>
        <UAlert
          v-if="refusals.length > 0"
          color="error"
          icon="i-lucide-circle-alert"
          :title="$t('expense.deleteRefused')"
          :description="refusals.join(' ')"
          class="mt-2"
        />
      </footer>
    </template>
    <UEmpty v-else icon="i-lucide-receipt-text" variant="naked" :title="$t('expense.notFound')" />
  </NuxtLayout>
</template>
