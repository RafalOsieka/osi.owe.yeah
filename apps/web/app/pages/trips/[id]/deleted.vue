<script setup lang="ts">
import { expenseShares } from '@osi/owe-yeah-domain';
import { toExpense, type LocalExpense } from '~/sync/local-trip';

// Recently deleted, opened from the Trip tab: the Trip's deleted Expenses, most recently
// deleted first (deletions not synced yet on top), each with who deleted it and when, and
// Restore. Restoring saves the Expense again, on top of its deletion, so it can cause a
// Conflict; one in Conflict opens the Conflict screen, and one not synced yet is marked.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const toast = useToast();

const tripPage = computed(() => `/trips/${trip.value.id}`);

const rows = computed(() => {
  const now = new Date();
  // Newest first: a deletion not synced yet (no server time) on top, then by ISO instant,
  // which sorts as text.
  const newestFirst = (a: LocalExpense, b: LocalExpense) => {
    const [at, bt] = [a.edited?.at ?? null, b.edited?.at ?? null];
    if (at === null || bt === null) return (at === null ? 0 : 1) - (bt === null ? 0 : 1);
    return bt.localeCompare(at);
  };
  return trip.value.deletedExpenses.toSorted(newestFirst).map((expense) => {
    const { edited, unsynced } = expense;
    const name = trip.value.participants.find(({ id }) => id === edited?.by)?.name;
    const when = edited?.at
      ? formatTimeAgo(edited.at, now, locale.value)
      : t('history.notSyncedYet');
    return {
      expense,
      deleted: t('deleted.row', {
        total: formatMoney(expenseShares(expense).total, expense.currency, locale.value),
        deleted: name ? t('deleted.by', { name, when }) : t('deleted.at', { when }),
      }),
      conflict: unsynced?.status === 'conflict',
      notSynced: unsynced !== null && unsynced.status !== 'conflict',
    };
  });
});

async function restore(expense: LocalExpense): Promise<void> {
  const refused = await saveExpense(toExpense(expense), expense.base);
  if (refused.length === 0) return;
  toast.add({
    title: t('history.restoreRefused'),
    description: refused.map((problem) => t(`expense.refused.${problem}`)).join(' '),
    color: 'error',
  });
}

useHead({ title: () => t('deleted.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('deleted.title')" :parent="`${tripPage}/settings`">
    <ul v-if="rows.length > 0">
      <li
        v-for="row in rows"
        :key="row.expense.id"
        class="flex items-center gap-2.5 border-b border-default py-2.5 last:border-b-0"
      >
        <span class="min-w-0 flex-1 leading-snug">
          <span class="block truncate font-semibold">{{ row.expense.title }}</span>
          <span class="block truncate text-xs text-muted">
            <NuxtLink
              v-if="row.conflict"
              :to="`${tripPage}/expenses/${row.expense.id}/conflict`"
              class="me-1"
            >
              <UBadge :label="$t('sync.conflictBadge')" color="error" variant="subtle" size="sm" />
            </NuxtLink>
            <UBadge
              v-else-if="row.notSynced"
              :label="$t('sync.notSynced')"
              color="neutral"
              variant="subtle"
              size="sm"
              class="me-1"
            />
            {{ row.deleted }}
          </span>
        </span>
        <UButton
          variant="outline"
          size="sm"
          :label="$t('deleted.restore')"
          :aria-label="$t('deleted.restoreTitle', { title: row.expense.title })"
          @click="restore(row.expense)"
        />
      </li>
    </ul>
    <UEmpty
      v-else
      icon="i-lucide-trash-2"
      variant="naked"
      :title="$t('deleted.empty')"
      :description="$t('deleted.emptyHelp')"
    />
  </NuxtLayout>
</template>
