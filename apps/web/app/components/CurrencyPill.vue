<script setup lang="ts">
import { CURRENCIES, type Currency } from '@osi/owe-yeah-domain';

// The Expense currency as a touch-sized pill under the amount, showing its code; it opens a
// searchable list of every currency in circulation, e.g. "HUF · Hungarian Forint".
const currency = defineModel<Currency>({ required: true });

const items = useCurrencyItems(CURRENCIES);
</script>

<template>
  <USelectMenu
    v-model="currency"
    :items="items"
    value-key="value"
    virtualize
    variant="soft"
    color="neutral"
    size="md"
    :aria-label="$t('rate.currency')"
    :content="{ align: 'center' }"
    :ui="{ base: 'h-11 rounded-full ps-4 font-medium', content: 'min-w-64' }"
  >
    <template #default="{ modelValue }">{{ modelValue }}</template>
  </USelectMenu>
</template>
