<script setup lang="ts">
import { expenseKind, isRepayment } from '@osi/owe-yeah-domain';

// Edit Expense: the Expense form filled with the Expense, or the Repayment form for a
// Repayment, opened from its detail page.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip } = useOpenTrip();
const { t } = useI18n();
const route = useRoute();

const expenseId = String(route.params.expenseId);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);
// Read once, like the form: a pull while editing must not reset what the user typed.
const expense = trip.value.expenses.find(({ id }) => id === expenseId);

// The tab is named like the form's heading: Edit Expense, Edit Income or Edit Repayment.
useHead({
  title: () => {
    switch (expense && expenseKind(expense).kind) {
      case 'repayment':
        return t('repayment.edit');
      case 'income':
        return t('expense.editIncome');
      default:
        return t('expense.edit');
    }
  },
});
</script>

<template>
  <RepaymentForm v-if="expense && isRepayment(expense)" :repayment="expense" :parent="detail" />
  <ExpenseForm v-else-if="expense" :expense="expense" :parent="detail" />
  <NuxtLayout v-else name="form" :title="$t('expense.edit')" :parent="detail">
    <UEmpty icon="i-lucide-receipt-text" variant="naked" :title="$t('expense.notFound')" />
  </NuxtLayout>
</template>
