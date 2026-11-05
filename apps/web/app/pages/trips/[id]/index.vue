<script setup lang="ts">
// The Expenses tab: the Trip's Expenses, each opening its detail page, and "+ Expense".
// While there are none, a welcome offers Add Expense, and Invite under it. Opened from a notification,
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
    <!-- Centred in the space between the header and the tabs, as My Trips' welcome is. -->
    <div
      v-else
      class="flex min-h-[calc(100dvh-17rem)] flex-col items-center justify-center px-4 text-center"
    >
      <span
        class="grid size-20 place-items-center rounded-3xl bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <UIcon name="i-lucide-receipt-text" class="size-9" />
      </span>
      <p class="mt-6 text-xl font-semibold tracking-tight text-highlighted">
        {{ $t('expense.empty') }}
      </p>
      <p class="mt-2 max-w-72 text-balance text-muted">{{ $t('expense.emptyHelp') }}</p>
      <UButton
        icon="i-lucide-plus"
        :label="$t('expense.add')"
        :disabled="!canAdd"
        :to="newExpense"
        size="xl"
        class="mt-8 px-6"
      />
      <UButton
        icon="i-lucide-share-2"
        :label="$t('invite.action')"
        color="neutral"
        variant="ghost"
        class="mt-2"
        @click="invite"
      />
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
        class="rounded-full px-5 shadow-lg shadow-black/15 dark:shadow-black/40"
      />
    </template>
  </NuxtLayout>
</template>
