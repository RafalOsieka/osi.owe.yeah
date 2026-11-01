<script setup lang="ts">
import type { Discount } from '@osi/owe-yeah-domain';
import type { DraftDiscount } from '~/utils/receipt-draft';

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

const kinds: readonly Discount['kind'][] = ['amount', 'percent'];
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
      <UFieldGroup role="group" :aria-label="$t('receipt.discountKind', { label })">
        <UButton
          v-for="kind in kinds"
          :key="kind"
          :label="kind === 'amount' ? currency : '%'"
          :aria-pressed="discount.kind === kind"
          :variant="discount.kind === kind ? 'solid' : 'outline'"
          color="neutral"
          @click="discount = { ...discount, kind }"
        />
      </UFieldGroup>
    </div>
  </UFormField>
</template>
