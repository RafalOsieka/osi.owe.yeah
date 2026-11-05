<script setup lang="ts">
// The large amount field that opens the Expense and Repayment forms: centred, with a decimal
// keypad on phones. The currency picker under it names the currency; `currency` labels the
// field for screen readers. What is typed is read leniently
// (`parseMoney`) by the Expense draft the form reads (`readDraft`).
const { currency } = defineProps<{ currency: string }>();
const amount = defineModel<string>({ required: true });
</script>

<template>
  <UInput
    v-model="amount"
    inputmode="decimal"
    placeholder="0"
    variant="none"
    :aria-description="currency"
    class="w-full"
    :ui="{
      base: 'h-20 text-center text-6xl font-semibold tracking-tight text-highlighted tabular-nums placeholder:text-dimmed',
    }"
  />
</template>
