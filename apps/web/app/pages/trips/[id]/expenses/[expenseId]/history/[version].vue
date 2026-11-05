<script setup lang="ts">
import { findExpense } from '~/sync/local-trip';

// One Revision of an Expense, opened from its History: the whole Expense as that change left
// it, titled "Earlier Revision" (or "Current Revision"), under a read-only notice saying who
// made the change and exactly when. Everything that differs from the Expense now is marked
// in amber below, the total with what it is now under it (`ExpenseDetails`), and the notice
// names what differs; or says nothing does. Restore
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

const formatWhen = (at: string) =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(at),
  );

// Who made the change and exactly when, e.g. "Changed by Kasia · Jul 5, 2026, 9:14 PM", so it
// isn't read as the Expense's own date in the header below.
const byline = computed(() => {
  if (!revision.value) return '';
  const { by, at } = revision.value.edited;
  if (by === claim.value?.id) return t('history.changedByYou', { when: formatWhen(at) });
  const name = everyone.value.find(({ id }) => id === by)?.name;
  const when = formatWhen(at);
  return name ? t('history.changedBy', { name, when }) : t('history.changedAt', { when });
});

// What of this Revision differs from the Expense now, named in the notice.
const now = computed(() => {
  const shown = current.value;
  const then = revision.value?.expense;
  if (!then || !shown || isCurrent.value) return null;
  const fields = changedFields(then, shown);
  if (fields.length === 0) return t('history.sameAsNow');
  return t('history.differsFromNow', {
    fields: new Intl.ListFormat(locale.value).format(
      // The amount moves the payer's part and the shares with it, as marked below.
      fields.map((field) =>
        field === 'amount' ? t('history.amountAndShares') : t(`history.field.${field}`),
      ),
    ),
  });
});

const canRestore = computed(
  () => !!revision.value && !revision.value.deleted && !!current.value && !isCurrent.value,
);

const title = computed(() =>
  isCurrent.value ? t('history.currentRevision') : t('history.earlierRevision'),
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
          <p v-if="revision.deleted" class="mt-1 text-toned">{{ $t('history.deletedHere') }}</p>
          <p v-if="now" class="mt-1 text-toned">{{ now }}</p>
        </div>
      </section>
      <ExpenseDetails :expense="revision.expense" :against="isCurrent ? null : (current ?? null)" />
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
