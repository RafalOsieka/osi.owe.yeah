<script setup lang="ts">
import type { AlertProps } from '@nuxt/ui';
import { expenseKind } from '@osi/owe-yeah-domain';
import { toExpense } from '~/sync/local-trip';

// An Expense's detail page: the Expense in full, with its total converted into the Trip
// currency; on top, why it is not synced yet if it isn't; at the bottom, one quiet card with
// its History (who last edited it and when, "you" for the claimed Participant) and Delete,
// named for what it deletes (Expense, Income or Repayment). A Conflict shows as an amber
// notice saying the details are this device's change, with a full-width primary Choose a change that
// opens the Conflict screen, Edit stepping back meanwhile; a rejected change is fixed with Edit
// or discarded, and one the server couldn't read is saved again from Edit or discarded. Edit
// opens the Expense form. Delete moves it to Recently deleted, with Undo
// for a moment. Should the Expense go (deleted, or a discarded new one), so does the page.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, everyone, discardChanges, deleteExpense, saveExpense } = useOpenTrip();
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

// "Last edited by Kasia, 2 hours ago" ("by you" for the claimed Participant), by the
// server's clock once it has the change.
const lastEdited = computed(() => {
  const edited = expense.value?.edited;
  if (!edited) return null;
  const name =
    edited.by === claim.value?.id
      ? t('history.byYou')
      : everyone.value.find(({ id }) => id === edited.by)?.name;
  const when = edited.at
    ? formatTimeAgo(edited.at, new Date(), locale.value, t('history.justNow'))
    : t('history.notSyncedYet');
  return name ? t('history.lastEditedBy', { name, when }) : t('history.lastEdited', { when });
});

// What the Expense is, for Edit's and Delete's names.
const kind = computed(() => (expense.value ? expenseKind(expense.value).kind : 'plain'));
const labels = computed(() => {
  switch (kind.value) {
    case 'repayment':
      return { edit: t('repayment.edit'), delete: t('repayment.delete') };
    case 'income':
      return { edit: t('expense.editIncome'), delete: t('expense.deleteIncome') };
    default:
      return { edit: t('expense.edit'), delete: t('expense.delete') };
  }
});

// The Conflict, when there is one: who else changed the Expense.
const conflict = computed(() => {
  const unsynced = expense.value?.unsynced;
  if (unsynced?.status !== 'conflict') return null;
  const author = trip.value.participants.find(({ id }) => id === unsynced.currentClaimId);
  return {
    title: author ? t('sync.conflictBy', { name: author.name }) : t('sync.conflictBySomeone'),
  };
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
    case 'conflict':
      return null;
    case 'pending':
      return { title: t('sync.pending'), color: 'neutral', icon: 'i-lucide-cloud-off' };
    case 'rejected': {
      const reason = unsynced.problems.map((problem) => t(`sync.reason.${problem}`)).join(' ');
      // A change the server couldn't read is saved again from the Expense form, as it stands.
      const malformed = unsynced.problems.includes('malformed');
      const discard = { label: t('sync.discard'), onClick: () => discardChanges(expenseId) };
      return {
        title: t('sync.rejected', { reason }),
        description: t(malformed ? 'sync.malformedHelp' : 'sync.rejectedHelp'),
        color: 'error',
        icon: 'i-lucide-cloud-off',
        actions: malformed
          ? [{ label: labels.value.edit, to: `${page.value}/edit` }, discard]
          : [discard],
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
        :color="conflict ? 'neutral' : 'primary'"
        :variant="conflict ? 'ghost' : 'soft'"
        icon="i-lucide-pencil"
        :label="$t('expense.editShort')"
        :aria-label="labels.edit"
        :to="`/trips/${trip.id}/expenses/${expense.id}/edit`"
      />
    </template>

    <template v-if="expense">
      <AttentionNote v-if="conflict" icon="i-lucide-triangle-alert" class="mb-4">
        <p class="font-medium">{{ conflict.title }}</p>
        <p class="mt-0.5 text-toned">{{ $t('sync.conflictShown') }}</p>
        <template #action>
          <UButton block :label="$t('sync.choose')" :to="`${page}/conflict`" />
        </template>
      </AttentionNote>
      <UAlert v-if="notSynced" v-bind="notSynced" variant="subtle" class="mb-4" />
      <ExpenseDetails :expense="expense" converted />

      <footer class="card mt-7 divide-y divide-default overflow-hidden">
        <NuxtLink
          :to="`${page}/history`"
          class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/60"
        >
          <UIcon name="i-lucide-history" class="size-5 shrink-0 text-muted" />
          <span class="min-w-0 flex-1 leading-snug">
            <span class="block text-highlighted">{{ $t('history.title') }}</span>
            <span v-if="lastEdited" class="block text-sm text-muted">{{ lastEdited }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
        </NuxtLink>
        <button
          type="button"
          class="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-3 text-start text-error transition-colors hover:bg-error/5"
          @click="remove"
        >
          <UIcon name="i-lucide-trash-2" class="size-5 shrink-0" />
          {{ labels.delete }}
        </button>
      </footer>
      <UAlert
        v-if="refusals.length > 0"
        color="error"
        icon="i-lucide-circle-alert"
        :title="$t('expense.deleteRefused')"
        :description="refusals.join(' ')"
        class="mt-2"
      />
    </template>
    <UEmpty v-else icon="i-lucide-receipt-text" variant="naked" :title="$t('expense.notFound')" />
  </NuxtLayout>
</template>
