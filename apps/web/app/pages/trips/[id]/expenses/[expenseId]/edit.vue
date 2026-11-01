<script setup lang="ts">
// Edit Expense: the Expense form filled with the Expense, opened from its detail page.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip } = useOpenTrip();
const { t } = useI18n();
const route = useRoute();

const expenseId = String(route.params.expenseId);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);
// Read once, like the form: a pull while editing must not reset what the user typed.
const expense = trip.value.expenses.find(({ id }) => id === expenseId);

useHead({ title: () => t('expense.edit') });
</script>

<template>
  <ExpenseForm v-if="expense" :expense="expense" :parent="detail" />
  <NuxtLayout v-else name="form" :title="$t('expense.edit')" :parent="detail">
    <UEmpty icon="i-lucide-receipt-text" variant="naked" :title="$t('expense.notFound')" />
  </NuxtLayout>
</template>
