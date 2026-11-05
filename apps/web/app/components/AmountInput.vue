<script setup lang="ts">
import { rational } from '@osi/owe-yeah-domain';

// The large amount field that opens the Expense and Repayment forms: centred on a quiet field
// that reads as editable even while empty, with the currency's symbol where the locale writes
// it ("€" before, "zł" after) and a "0.00" placeholder in its decimals, and a decimal keypad on
// phones. The field keeps one outline in every state, so an error recolours it rather than
// moving what is around it. The currency picker under it names the currency; `currency` also
// labels the field for screen readers. What is typed is read leniently (`parseMoney`) by the
// Expense draft the form reads (`readDraft`).
const { currency } = defineProps<{ currency: string }>();
const amount = defineModel<string>({ required: true });

const { locale } = useI18n();

const placeholder = computed(() => formatMoney(rational(0n), currency, locale.value, 'number'));

// The currency's symbol, and whether the locale writes it before the number.
const symbol = computed(() => {
  const parts = new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).formatToParts(0);
  const at = (type: Intl.NumberFormatPartTypes) => parts.findIndex((part) => part.type === type);
  return { text: parts[at('currency')]?.value ?? currency, before: at('currency') < at('integer') };
});

// As wide as what is typed, and aligned towards the symbol, so it stays next to the digits.
const width = computed(() => `${Math.max((amount.value || placeholder.value).length, 1)}ch`);
</script>

<template>
  <div
    class="flex h-18 items-center justify-center gap-1.5 rounded-2xl bg-elevated/60 px-4 ring-2 ring-transparent transition-colors focus-within:ring-primary has-[[aria-invalid=true]]:ring-error dark:bg-elevated"
  >
    <span v-if="symbol.before" class="text-3xl font-semibold text-muted" aria-hidden="true">
      {{ symbol.text }}
    </span>
    <UInput
      :model-value="amount"
      inputmode="decimal"
      :placeholder="placeholder"
      variant="none"
      :aria-description="currency"
      :style="{ width }"
      class="max-w-full min-w-0"
      :ui="{
        base: [
          'h-16 px-0 text-5xl font-semibold tracking-tight text-highlighted tabular-nums ring-0! outline-none! placeholder:text-dimmed',
          symbol.before ? 'text-start' : 'text-end',
        ],
      }"
      @update:model-value="amount = String($event)"
    />
    <span v-if="!symbol.before" class="text-3xl font-semibold text-muted" aria-hidden="true">
      {{ symbol.text }}
    </span>
  </div>
</template>
