<script setup lang="ts">
// New Expense: the Expense form, opened from the Expenses tab.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip } = useOpenTrip();
const { t } = useI18n();

useHead({ title: () => t('expense.new') });
</script>

<template>
  <ExpenseForm :parent="`/trips/${trip.id}`" />
</template>
