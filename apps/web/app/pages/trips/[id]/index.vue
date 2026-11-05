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
    <UEmpty
      v-else
      icon="i-lucide-receipt-text"
      variant="naked"
      :title="$t('expense.empty')"
      :description="$t('expense.emptyHelp')"
      :actions="[
        {
          label: $t('expense.addFirst'),
          icon: 'i-lucide-plus',
          disabled: !canAdd,
          to: newExpense,
        },
        {
          label: $t('invite.action'),
          icon: 'i-lucide-share-2',
          variant: 'outline',
          onClick: invite,
        },
      ]"
      class="pt-16"
    />

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
