<script setup lang="ts">
import { rational } from '@osi/owe-yeah-domain';

// A money field as the Expense, Receipt and Repayment forms take every amount but the big one
// on top (`AmountInput`): the decimal keypad, tabular digits, a "0.00" placeholder in the
// currency's decimals, and the currency marked as `formatMoney` marks it (`currencySymbol`):
// "€" before the number in English, "€" after it in Polish, so typed and computed amounts
// read alike. `bare` leaves the mark out, e.g. for a discount whose unit is picked beside it,
// and `placeholder` replaces the "0.00". Labelled by its `UFormField` or an `aria-label`; any
// other attribute (`id`, `color`) goes to the field.
const {
  currency,
  bare = false,
  placeholder = undefined,
} = defineProps<{
  currency: string;
  bare?: boolean;
  placeholder?: string;
}>();
const value = defineModel<string>({ required: true });

const { locale } = useI18n();
const zero = computed(
  () => placeholder ?? formatMoney(rational(0n), currency, locale.value, 'number'),
);
const symbol = computed(() => currencySymbol(currency, locale.value));

const input = useTemplateRef('input');
defineExpose({ focus: () => input.value?.inputRef?.focus() });
</script>

<template>
  <UInput
    ref="input"
    :model-value="value"
    inputmode="decimal"
    :placeholder="zero"
    :ui="{
      base: 'text-end tabular-nums',
      leading: 'pointer-events-none',
      trailing: 'pointer-events-none',
    }"
    @update:model-value="value = String($event)"
  >
    <template v-if="!bare && symbol.before" #leading>
      <span class="text-muted">{{ symbol.text }}</span>
    </template>
    <template v-if="!bare && !symbol.before" #trailing>
      <span class="text-muted">{{ symbol.text }}</span>
    </template>
  </UInput>
</template>
