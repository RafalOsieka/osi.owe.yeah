<script setup lang="ts">
import { usePrototype } from '~/prototype/photos-drafts';

// New Expense: the Expense form, opened from the Expenses tab. The form titles the tab.
// PROTOTYPE (#282): in the Expenses tab's variant C, Scan a Receipt sits on top of the form.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip } = useOpenTrip();
const proto = usePrototype();
const scanner = useTemplateRef<{ startScan: () => void }>('scanner');
const back = useBack();
const scanOnTop = computed(() => proto.variant('expenses') === 'C');
const before = ref(proto.state.drafts.length);
// Scanning from the form leaves it for the Expenses tab, where the Draft shows.
watch(
  () => proto.state.drafts.length,
  (now) => {
    if (now > before.value) void back(`/trips/${trip.value.id}`);
  },
);
</script>

<template>
  <ExpenseForm :parent="`/trips/${trip.id}`">
    <template v-if="scanOnTop" #top>
      <PrototypeTabDrafts ref="scanner" place="none" />
      <button
        type="button"
        class="card mb-5 flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-start"
        @click="scanner?.startScan()"
      >
        <UIcon name="i-lucide-scan-line" class="size-6 shrink-0 text-primary" />
        <span class="min-w-0 flex-1 leading-snug">
          <span class="block font-medium text-primary">Scan a Receipt instead</span>
          <span class="block text-sm text-muted">Its Line items are read for you to check</span>
        </span>
      </button>
    </template>
  </ExpenseForm>
</template>
