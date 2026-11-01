<script setup lang="ts">
// The large amount field that opens the Expense and Repayment forms: centred, with the
// currency after it and a decimal keypad on phones. What is typed is read leniently
// (`parseMoney`) by the form.
const { currency } = defineProps<{ currency: string }>();
const amount = defineModel<string>({ required: true });
</script>

<template>
  <UInput
    v-model="amount"
    inputmode="decimal"
    placeholder="0"
    variant="none"
    class="w-full"
    :ui="{
      base: 'h-16 text-center text-4xl font-bold tabular-nums',
      trailing: 'pe-2',
    }"
  >
    <template #trailing>
      <span class="text-xl font-semibold text-muted">{{ currency }}</span>
    </template>
  </UInput>
</template>
