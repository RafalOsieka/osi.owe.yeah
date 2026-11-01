<script setup lang="ts">
import { findExpense } from '~/sync/local-trip';

// The Conflict screen, opened from the notice on an Expense's detail page: this device's
// version of the Expense next to the one the server has, each with who made it where known,
// and marked when it deletes the Expense.
// Keep mine sends this device's version again on top of theirs; keep theirs drops it. Either
// returns to the detail page.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, keepMine, discardChanges } = useOpenTrip();
const { t } = useI18n();
const route = useRoute();
const back = useBack();

const expenseId = String(route.params.expenseId);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);

const conflict = computed(() => {
  const mine = findExpense(trip.value, expenseId);
  return mine?.unsynced?.status === 'conflict' ? { mine, held: mine.unsynced } : null;
});

const resolving = ref(false);

async function resolve(keep: (expenseId: string) => Promise<void>): Promise<void> {
  resolving.value = true;
  try {
    await keep(expenseId);
    await back(detail.value);
  } finally {
    resolving.value = false;
  }
}

useHead({ title: () => t('conflict.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('conflict.title')" :parent="detail">
    <template v-if="conflict">
      <p class="mb-4 text-sm text-muted">{{ $t('conflict.help') }}</p>
      <div class="flex flex-col gap-3">
        <ExpenseVersion
          :heading="$t('conflict.mine')"
          :expense="conflict.mine"
          :deleted="conflict.mine.deleted"
          :author-id="conflict.held.claimId"
          :participants="trip.participants"
        />
        <ExpenseVersion
          :heading="$t('conflict.theirs')"
          :expense="conflict.held.current"
          :deleted="conflict.held.current.deleted"
          :author-id="conflict.held.currentClaimId"
          :participants="trip.participants"
        />
      </div>
    </template>
    <UEmpty v-else icon="i-lucide-circle-check" variant="naked" :title="$t('conflict.none')" />

    <template v-if="conflict" #action>
      <div class="flex gap-2">
        <UButton
          class="flex-1 justify-center"
          size="xl"
          variant="outline"
          :disabled="resolving"
          :label="$t('conflict.keepTheirs')"
          @click="resolve(discardChanges)"
        />
        <UButton
          class="flex-1 justify-center"
          size="xl"
          :disabled="resolving"
          :label="$t('conflict.keepMine')"
          @click="resolve(keepMine)"
        />
      </div>
    </template>
  </NuxtLayout>
</template>
