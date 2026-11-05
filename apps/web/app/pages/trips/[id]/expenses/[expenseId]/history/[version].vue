<script setup lang="ts">
import { expenseShares } from '@osi/owe-yeah-domain';
import { findExpense } from '~/sync/local-trip';

// One Revision of an Expense, opened from its History: the whole Expense as that change left
// it, titled as an earlier version (or the current one), under a read-only notice saying who
// made the change and exactly when, what the Expense is now and what differs from it. Restore
// saves it again as a normal change on top of the current version (so it can cause a
// Conflict), deleted or not, keeping the current version in History, as the line beside it
// says, and opens the Expense. Not offered for a Revision that deleted the Expense, nor for
// the version the Expense is at.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, everyone, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const expenseId = String(route.params.expenseId);
const version = Number(route.params.version);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);

const { data, status } = useRevisions(expenseId);
const revision = computed(() => data.value?.find((other) => other.version === version));
const current = computed(() => findExpense(trip.value, expenseId));

const isCurrent = computed(() => {
  const shown = current.value;
  return !!shown && 'version' in shown.base && shown.base.version === version && !shown.deleted;
});

// Who made the change and exactly when, e.g. "Kasia · Jul 5, 2026, 9:14 PM".
const byline = computed(() => {
  if (!revision.value) return '';
  const { by, at } = revision.value.edited;
  const name =
    by === claim.value?.id ? t('history.you') : everyone.value.find(({ id }) => id === by)?.name;
  const when = new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(at));
  return name ? t('history.byline', { name, when }) : when;
});

// What the Expense is now, and what of it differs from this Revision.
const now = computed(() => {
  const shown = current.value;
  if (!revision.value || !shown || isCurrent.value) return null;
  const fields = changedFields(revision.value.expense, shown);
  return {
    total: t('history.nowIs', {
      amount: formatMoney(expenseShares(shown).total, shown.currency, locale.value),
    }),
    differs:
      fields.length > 0
        ? t('history.differsFromNow', {
            fields: new Intl.ListFormat(locale.value).format(
              fields.map((field) => t(`history.field.${field}`)),
            ),
          })
        : null,
  };
});

const canRestore = computed(
  () => !!revision.value && !revision.value.deleted && !!current.value && !isCurrent.value,
);

const title = computed(() =>
  isCurrent.value ? t('history.currentVersion') : t('history.earlierVersion'),
);

// Which Trip rules the restore broke; nothing was saved.
const refusals = ref<string[]>([]);
const restoring = ref(false);

async function restore(): Promise<void> {
  if (!revision.value || !current.value) return;
  restoring.value = true;
  const refused = await saveExpense(revision.value.expense, current.value).finally(
    () => (restoring.value = false),
  );
  refusals.value = refused.map((problem) => t(`expense.refused.${problem}`));
  if (refused.length === 0) await router.replace(detail.value);
}

useHead({ title });
</script>

<template>
  <NuxtLayout name="form" :title="title" :parent="`${detail}/history`">
    <template v-if="revision">
      <section class="card mb-4 flex gap-3 p-4">
        <UIcon name="i-lucide-history" class="mt-0.5 size-5 shrink-0 text-muted" />
        <div class="min-w-0 text-sm leading-snug">
          <p class="font-medium text-highlighted">{{ byline }}</p>
          <p class="mt-1 text-toned">
            {{ revision.deleted ? $t('history.deletedHere') : $t('history.readOnly') }}
            <template v-if="now">{{ now.total }}</template>
          </p>
          <p v-if="now?.differs" class="mt-1 text-toned">{{ now.differs }}</p>
        </div>
      </section>
      <ExpenseDetails :expense="revision.expense" />
      <!-- Room for Restore's line, which the fixed action area grows by. -->
      <div v-if="canRestore" class="h-8" aria-hidden="true" />
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
      <p class="mt-2 text-center text-sm text-muted">{{ $t('history.restoreHelp') }}</p>
    </template>
  </NuxtLayout>
</template>
