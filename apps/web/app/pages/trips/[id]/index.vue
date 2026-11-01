<script setup lang="ts">
// The Expenses tab: the Trip's Expenses, each opening its detail page, and "+ Expense".
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim } = useOpenTrip();

const canAdd = computed(() => trip.value.participants.length > 0);
const newExpense = computed(() => `/trips/${trip.value.id}/expenses/new`);
</script>

<template>
  <NuxtLayout name="trip">
    <ExpenseList v-if="trip.expenses.length > 0" :trip="trip" :claim-id="claim?.id" />
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
        class="rounded-2xl shadow-lg"
      />
    </template>
  </NuxtLayout>
</template>
