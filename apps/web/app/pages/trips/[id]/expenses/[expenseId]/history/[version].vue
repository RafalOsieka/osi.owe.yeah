<script setup lang="ts">
import { findExpense } from '~/sync/local-trip';

// One Revision of an Expense, opened from its History: the whole Expense as that change left
// it, who made it and when. Restore saves it again as a normal change on top of the current
// version (so it can cause a Conflict), deleted or not, and opens the Expense. Not offered for
// a Revision that deleted the Expense, nor for the version the Expense is at.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const expenseId = String(route.params.expenseId);
const version = Number(route.params.version);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);

const { data, status } = useRevisions(expenseId);
const revision = computed(() => data.value?.find((other) => other.version === version));
const current = computed(() => findExpense(trip.value, expenseId));

const byline = computed(() => {
  if (!revision.value) return '';
  const { by, at } = revision.value.edited;
  const name = trip.value.participants.find(({ id }) => id === by)?.name;
  const when = formatTimeAgo(at, new Date(), locale.value);
  return name ? t('history.byline', { name, when }) : when;
});

const canRestore = computed(() => {
  const shown = current.value;
  if (!revision.value || revision.value.deleted || !shown) return false;
  const isCurrent = 'version' in shown.base && shown.base.version === version && !shown.deleted;
  return !isCurrent;
});

// Which Trip rules the restore broke; nothing was saved.
const refusals = ref<string[]>([]);
const restoring = ref(false);

async function restore(): Promise<void> {
  if (!revision.value || !current.value) return;
  restoring.value = true;
  const refused = await saveExpense(revision.value.expense, current.value.base).finally(
    () => (restoring.value = false),
  );
  refusals.value = refused.map((problem) => t(`expense.refused.${problem}`));
  if (refused.length === 0) await router.replace(detail.value);
}

useHead({ title: () => t('history.version', { version }) });
</script>

<template>
  <NuxtLayout name="form" :title="$t('history.version', { version })" :parent="`${detail}/history`">
    <template v-if="revision">
      <p class="mb-3 text-sm text-muted">{{ byline }}</p>
      <UAlert
        v-if="revision.deleted"
        color="neutral"
        variant="subtle"
        icon="i-lucide-trash-2"
        :title="$t('history.deletedHere')"
        class="mb-4"
      />
      <ExpenseDetails :expense="revision.expense" />
    </template>
    <UEmpty
      v-else-if="status === 'error'"
      icon="i-lucide-cloud-off"
      variant="naked"
      :title="$t('history.offline')"
    />
    <UEmpty
      v-else-if="status === 'success'"
      icon="i-lucide-history"
      variant="naked"
      :title="$t('history.notFound')"
    />

    <template v-if="canRestore" #action>
      <UAlert
        v-if="refusals.length > 0"
        color="error"
        icon="i-lucide-circle-alert"
        :title="$t('history.restoreRefused')"
        :description="refusals.join(' ')"
        class="mb-3"
      />
      <UButton
        block
        size="xl"
        icon="i-lucide-undo-2"
        :loading="restoring"
        :label="$t('history.restore')"
        @click="restore"
      />
    </template>
  </NuxtLayout>
</template>
