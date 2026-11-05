<script setup lang="ts">
import type { Discount } from '@osi/owe-yeah-domain';
import type { DraftDiscount } from '~/utils/expense-draft';

// A Line or Receipt discount as typed: its value, and whether that is an amount in the
// currency or a percentage. Empty means no discount. `error` says why it can't be used, if
// it can't; the form reads and checks it.
const {
  label,
  currency,
  error = null,
} = defineProps<{
  label: string;
  currency: string;
  error?: string | null;
}>();
const discount = defineModel<DraftDiscount>({ required: true });

const kinds = computed(() =>
  (['amount', 'percent'] as const satisfies readonly Discount['kind'][]).map((value) => ({
    value,
    label: value === 'amount' ? currency : '%',
  })),
);
const kind = computed({
  get: () => discount.value.kind,
  set: (value: Discount['kind']) => (discount.value = { ...discount.value, kind: value }),
});
</script>

<template>
  <UFormField :label="label" :error="error ?? undefined">
    <div class="flex gap-2">
      <UInput
        :model-value="discount.value"
        inputmode="decimal"
        placeholder="0"
        :color="error ? 'error' : undefined"
        class="flex-1"
        @update:model-value="discount = { ...discount, value: String($event) }"
      />
      <SegmentedControl
        v-model="kind"
        :options="kinds"
        :label="$t('receipt.discountKind', { label })"
        class="shrink-0 self-center"
      />
    </div>
  </UFormField>
</template>
