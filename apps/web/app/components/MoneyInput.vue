<script setup lang="ts">
import { rational } from '@osi/owe-yeah-domain';

// A money field as the Expense, Receipt and Repayment forms take every amount but the big one
// on top (`AmountInput`): the decimal keypad, the digits right-aligned and tabular, a "0.00"
// placeholder in the currency's decimals, and the currency code after it, so each amount says
// what it is in. `suffix` and `placeholder` replace those, e.g. for a discount whose unit is
// picked beside it; an empty `suffix` shows none. Labelled by its `UFormField` or an
// `aria-label`; any other attribute (`id`, `color`) goes to the field.
const {
  currency,
  suffix = undefined,
  placeholder = undefined,
} = defineProps<{
  currency: string;
  suffix?: string;
  placeholder?: string;
}>();
const value = defineModel<string>({ required: true });

const { locale } = useI18n();
const zero = computed(
  () => placeholder ?? formatMoney(rational(0n), currency, locale.value, 'number'),
);

const input = useTemplateRef('input');
defineExpose({ focus: () => input.value?.inputRef?.focus() });
</script>

<template>
  <UInput
    ref="input"
    :model-value="value"
    inputmode="decimal"
    :placeholder="zero"
    :ui="{ base: 'h-11 text-end tabular-nums', trailing: 'pointer-events-none' }"
    @update:model-value="value = String($event)"
  >
    <template v-if="suffix !== ''" #trailing>
      <span class="text-sm text-muted">{{ suffix ?? currency }}</span>
    </template>
  </UInput>
</template>
