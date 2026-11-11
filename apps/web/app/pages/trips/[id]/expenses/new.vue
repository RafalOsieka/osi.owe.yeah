<script setup lang="ts">
// New Expense: the Expense form, opened from the Expenses tab. The form titles the tab.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip } = useOpenTrip();
</script>

<template>
  <ExpenseForm :parent="`/trips/${trip.id}`" />
</template>
