<script setup lang="ts">
// The Expenses tab: the Trip's Expenses, each opening its detail page, and "+ Expense".
// While there are none, it offers the first Expense and Invite. Opened from a notification,
// `?highlight=<id>` marks the Expense it was about (#41), until the tab is opened again: the
// address loses it at once, so a reload doesn't mark it again.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim, invite } = useOpenTrip();
const route = useRoute();
const router = useRouter();
const highlight = ref<string | null>(null);
watch(
  () => route.query.highlight,
  (id) => {
    if (!id) return;
    highlight.value = String(id);
    const { highlight: _, ...query } = route.query;
    void router.replace({ query, hash: route.hash });
  },
  { immediate: true },
);

const canAdd = computed(() => trip.value.participants.length > 0);
const newExpense = computed(() => `/trips/${trip.value.id}/expenses/new`);
</script>

<template>
  <NuxtLayout name="trip">
    <ExpenseList
      v-if="trip.expenses.length > 0"
      :trip="trip"
      :claim-id="claim?.id"
      :highlight-id="highlight"
    />
    <div v-else class="flex flex-col items-center px-4 pt-16 text-center">
      <span
        class="grid size-20 place-items-center rounded-3xl bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <UIcon name="i-lucide-receipt-text" class="size-9" />
      </span>
      <p class="mt-6 text-xl font-semibold tracking-tight text-highlighted">
        {{ $t('expense.empty') }}
      </p>
      <p class="mt-1.5 max-w-72 text-muted">{{ $t('expense.emptyHelp') }}</p>
      <div class="mt-7 flex flex-wrap justify-center gap-2.5">
        <UButton
          icon="i-lucide-plus"
          :label="$t('expense.addFirst')"
          :disabled="!canAdd"
          :to="newExpense"
          size="lg"
          class="shadow-md shadow-primary/20"
        />
        <UButton
          icon="i-lucide-share-2"
          :label="$t('invite.action')"
          color="neutral"
          variant="outline"
          size="lg"
          @click="invite"
        />
      </div>
    </div>

    <!-- While the list is empty, the empty state offers the button instead. -->
    <template v-if="trip.expenses.length > 0" #action>
      <UButton
        icon="i-lucide-plus"
        :label="$t('expense.addShort')"
        :aria-label="$t('expense.add')"
        :disabled="!canAdd"
        :to="newExpense"
        size="xl"
        class="rounded-full px-5 shadow-lg shadow-primary/30"
      />
    </template>
  </NuxtLayout>
</template>
