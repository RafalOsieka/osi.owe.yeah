<script setup lang="ts">
import type { Discount } from '@osi/owe-yeah-domain';
import type { DraftDiscount } from '~/utils/expense-draft';

// A Line or Receipt discount as typed: its value, and beside it whether that is an amount in
// the currency or a percentage, which names its unit. Empty means no discount, so
// the field is marked optional; `help` says more under it. `error` says why it can't be used,
// if it can't; the form reads and checks it.
const {
  label,
  currency,
  help = undefined,
  optional = true,
  error = null,
} = defineProps<{
  label: string;
  currency: string;
  help?: string;
  /** Marks the field optional; off where its section says so already. */
  optional?: boolean;
  error?: string | null;
}>();
const discount = defineModel<DraftDiscount>({ required: true });

const { locale } = useI18n();

const kinds = computed(() =>
  (['amount', 'percent'] as const satisfies readonly Discount['kind'][]).map((value) => ({
    value,
    label: value === 'amount' ? currencySymbol(currency, locale.value).text : '%',
  })),
);
const kind = computed({
  get: () => discount.value.kind,
  set: (value: Discount['kind']) => (discount.value = { ...discount.value, kind: value }),
});
</script>

<template>
  <UFormField
    :label="label"
    :hint="optional ? $t('form.optional') : undefined"
    :help="help"
    :error="error ?? undefined"
  >
    <div class="flex gap-2">
      <MoneyInput
        :model-value="discount.value"
        :currency="currency"
        bare
        :placeholder="discount.kind === 'percent' ? '0' : undefined"
        :color="error ? 'error' : undefined"
        class="min-w-0 flex-1"
        @update:model-value="discount = { ...discount, value: $event }"
      />
      <SegmentedControl
        v-model="kind"
        :options="kinds"
        :label="$t('receipt.discountKind', { label })"
        class="w-32 shrink-0"
      />
    </div>
  </UFormField>
</template>
