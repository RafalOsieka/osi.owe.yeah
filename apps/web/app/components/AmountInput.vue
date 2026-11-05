<script setup lang="ts">
import { rational } from '@osi/owe-yeah-domain';

// The large amount field that opens the Expense and Repayment forms: a quiet field that reads
// as editable even while empty, the currency marked as every amount on the form marks it
// (`currencySymbol`: "€ 0.00", "0,00 €"; a bare code like "HUF" is left to the picker) with a
// "0.00" placeholder in its decimals, and a decimal keypad on phones. Its end is left free for
// the currency picker, which the form lays over it (outside the field, so the picker isn't
// taken for the amount's input), so amount and currency are one row. The field keeps one
// outline in every state, so an error recolours it rather than moving what is around it.
// `currency` also labels the field for screen readers. What is typed is read leniently
// (`parseMoney`) by the Expense draft the form reads (`readDraft`).
const { currency } = defineProps<{ currency: string }>();
const amount = defineModel<string>({ required: true });

const { locale } = useI18n();

const placeholder = computed(() => formatMoney(rational(0n), currency, locale.value, 'number'));
// The currency's mark; none where it is only its code ("HUF"), which the picker beside it says.
const symbol = computed(() => {
  const mark = currencySymbol(currency, locale.value);
  return mark.text === currency ? null : mark;
});

// As wide as what is typed, so the mark after it stays next to the digits.
const width = computed(() => `${Math.max((amount.value || placeholder.value).length, 1)}ch`);
</script>

<template>
  <div
    class="flex h-18 items-center gap-2 rounded-2xl bg-elevated/60 ps-4 pe-30 ring ring-transparent transition-colors focus-within:ring-2 focus-within:ring-primary has-[[aria-invalid=true]]:ring-error dark:bg-elevated"
  >
    <div class="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
      <span
        v-if="symbol?.before"
        class="shrink-0 text-2xl font-semibold text-muted"
        aria-hidden="true"
      >
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
          base: 'h-16 px-0 text-[2.75rem] font-semibold tracking-tight text-highlighted tabular-nums ring-0! outline-none! placeholder:text-muted',
        }"
        @update:model-value="amount = String($event)"
      />
      <span
        v-if="symbol && !symbol.before"
        class="shrink-0 text-2xl font-semibold text-muted"
        aria-hidden="true"
      >
        {{ symbol.text }}
      </span>
    </div>
  </div>
</template>
