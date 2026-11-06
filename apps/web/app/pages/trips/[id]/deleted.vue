<script setup lang="ts">
import { expenseShares } from '@osi/owe-yeah-domain';
import { toExpense, type LocalExpense } from '~/sync/local-trip';

// Recently deleted, opened from the Trip tab: the Trip's deleted Expenses, most recently
// deleted first (deletions not synced yet on top), each with its total on the right like every
// list, who deleted it and when, and Restore. Nothing removes them for good, so the page says
// they stay until restored. Restoring saves the Expense again, on top of its deletion, so it can cause a
// Conflict; one in Conflict opens the Conflict screen, and one not synced yet is marked.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, everyone, saveExpense } = useOpenTrip();
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
    // "by you" needs both a Claim and a known author; without them `undefined === undefined`.
    const byYou = claim.value !== null && edited?.by === claim.value.id;
    const name = everyone.value.find(({ id }) => id === edited?.by)?.name;
    const when = edited?.at
      ? formatTimeAgo(edited.at, now, locale.value, t('history.justNow'))
      : t('history.notSyncedYet');
    return {
      expense,
      total: formatMoney(expenseShares(expense).total, expense.currency, locale.value),
      deleted: byYou
        ? t('deleted.byYou', { when })
        : name
          ? t('deleted.by', { name, when })
          : t('deleted.at', { when }),
      conflict: unsynced?.status === 'conflict',
      notSynced: unsynced !== null && unsynced.status !== 'conflict',
    };
  });
});

async function restore(expense: LocalExpense): Promise<void> {
  const refused = await saveExpense(toExpense(expense), expense);
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
    <template v-if="rows.length > 0">
      <ul class="card divide-y divide-default">
        <!-- Title and total on top, the total at the row's right edge as in every list; who
             deleted it and Restore under them. -->
        <li v-for="row in rows" :key="row.expense.id" class="px-4 pt-3 pb-2.5">
          <span class="flex items-baseline gap-3">
            <span class="min-w-0 flex-1 truncate font-medium text-highlighted">
              {{ row.expense.title }}
            </span>
            <span class="shrink-0 font-semibold text-highlighted tabular-nums">
              {{ row.total }}
            </span>
          </span>
          <span class="flex items-center gap-3">
            <span class="min-w-0 flex-1 text-sm text-muted">
              <NuxtLink
                v-if="row.conflict"
                :to="`${tripPage}/expenses/${row.expense.id}/conflict`"
                class="me-1"
              >
                <UBadge
                  :label="$t('sync.conflictBadge')"
                  color="warning"
                  variant="subtle"
                  size="md"
                />
              </NuxtLink>
              <UBadge
                v-else-if="row.notSynced"
                :label="$t('sync.notSynced')"
                color="neutral"
                variant="subtle"
                size="md"
                class="me-1"
              />
              {{ row.deleted }}
            </span>
            <UButton
              variant="soft"
              :label="$t('deleted.restore')"
              :aria-label="$t('deleted.restoreTitle', { title: row.expense.title })"
              class="shrink-0"
              @click="restore(row.expense)"
            />
          </span>
        </li>
      </ul>
      <p class="mt-3 px-4 text-sm text-muted">{{ $t('deleted.kept') }}</p>
    </template>
    <UEmpty
      v-else
      icon="i-lucide-trash-2"
      variant="naked"
      :title="$t('deleted.empty')"
      :description="$t('deleted.emptyHelp')"
    />
  </NuxtLayout>
</template>
