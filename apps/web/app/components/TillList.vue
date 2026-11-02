<script setup lang="ts">
import {
  MAX_UNITS,
  minorUnits,
  newLineItemSplit,
  parseMoney,
  type Participant,
} from '@osi/owe-yeah-domain';
import { draftLineItem, type DraftLineItem } from '~/utils/receipt-draft';

// A Receipt's Line items as the Till list enters them, at the till: one line after the
// other, each opened in place to edit it (one at a time), with the add forms at the end: one
// for goods, with an optional Deposit per unit, and one for a Deposit refund. New goods copy
// the previous goods' split when it was Even, and otherwise start Even across all
// Participants; a Deposit refund always starts Even across all Participants.
const { participants, currency } = defineProps<{
  participants: readonly Participant[];
  currency: string;
}>();
const lineItems = defineModel<DraftLineItem[]>({ required: true });

const { t } = useI18n();

const openKey = ref<string | null>(null);

const everyone = () => participants.map(({ id }) => id);
const amountInvalid = () => {
  const decimals = minorUnits(currency);
  return t('expense.amountInvalid', { decimals }, decimals);
};

const adding = reactive({ name: '', price: '', quantity: 1, deposit: '' });
const addError = ref<string | null>(null);
const priceInput = useTemplateRef('price');

function add(): void {
  if (parseMoney(adding.price, currency) === null) {
    addError.value = amountInvalid();
    return;
  }
  if (adding.deposit.trim() !== '' && parseMoney(adding.deposit, currency) === null) {
    addError.value = t('receipt.depositUnreadable');
    return;
  }
  lineItems.value = [
    ...lineItems.value,
    draftLineItem({
      name: adding.name.trim(),
      price: adding.price,
      quantity: adding.quantity,
      deposit: adding.deposit.trim(),
      split: newLineItemSplit(
        lineItems.value.filter(({ refund }) => !refund),
        everyone(),
      ),
    }),
  ];
  Object.assign(adding, { name: '', price: '', quantity: 1, deposit: '' });
  addError.value = null;
  priceInput.value?.inputRef?.focus();
}

const refundAmount = ref('');
const refundError = ref<string | null>(null);

function addRefund(): void {
  if (parseMoney(refundAmount.value, currency) === null) {
    refundError.value = amountInvalid();
    return;
  }
  lineItems.value = [
    ...lineItems.value,
    draftLineItem({
      name: '',
      price: refundAmount.value,
      quantity: 1,
      refund: true,
      split: { mode: 'even', participantIds: everyone() },
    }),
  ];
  refundAmount.value = '';
  refundError.value = null;
}

function replace(index: number, line: DraftLineItem): void {
  lineItems.value = lineItems.value.with(index, line);
}

function move(index: number, by: -1 | 1): void {
  const moved = [...lineItems.value];
  const [line] = moved.splice(index, 1);
  moved.splice(index + by, 0, line!);
  lineItems.value = moved;
}

function remove(index: number): void {
  lineItems.value = lineItems.value.toSpliced(index, 1);
}
</script>

<template>
  <section aria-labelledby="till-list-heading" class="space-y-2">
    <h2 id="till-list-heading" class="text-sm font-medium">{{ $t('receipt.lineItems') }}</h2>
    <ol v-if="lineItems.length > 0" class="space-y-2">
      <TillLine
        v-for="(line, index) in lineItems"
        :key="line.key"
        :line="line"
        :open="openKey === line.key"
        :participants="participants"
        :currency="currency"
        :position="index + 1"
        :first="index === 0"
        :last="index === lineItems.length - 1"
        @update:line="replace(index, $event)"
        @update:open="openKey = $event ? line.key : null"
        @move="move(index, $event)"
        @remove="remove(index)"
      />
    </ol>

    <div
      role="group"
      :aria-label="$t('receipt.addLineItem')"
      class="space-y-2 rounded-lg border border-dashed border-default p-2.5"
    >
      <div class="flex gap-2">
        <UInput
          ref="price"
          v-model="adding.price"
          inputmode="decimal"
          :placeholder="$t('receipt.unitPrice')"
          :aria-label="$t('receipt.newUnitPrice')"
          :color="addError ? 'error' : undefined"
          class="flex-1"
          @keydown.enter.prevent="add"
        >
          <template #trailing>
            <span class="text-xs text-muted">{{ currency }}</span>
          </template>
        </UInput>
        <UInputNumber
          v-model="adding.quantity"
          :min="1"
          :max="MAX_UNITS"
          :aria-label="$t('receipt.newQuantity')"
          class="w-32"
        />
      </div>
      <div class="flex gap-2">
        <UInput
          v-model="adding.name"
          :placeholder="$t('receipt.namePlaceholder')"
          :aria-label="$t('receipt.newName')"
          class="min-w-0 flex-1"
          @keydown.enter.prevent="add"
        />
        <UInput
          v-model="adding.deposit"
          inputmode="decimal"
          :placeholder="$t('receipt.depositPlaceholder')"
          :aria-label="$t('receipt.newDeposit')"
          class="w-24"
          @keydown.enter.prevent="add"
        />
        <UButton icon="i-lucide-plus" :label="$t('receipt.add')" @click="add" />
      </div>
      <p v-if="addError" class="text-sm text-error">{{ addError }}</p>
    </div>

    <div
      role="group"
      :aria-label="$t('receipt.addDepositRefund')"
      class="space-y-2 rounded-lg border border-dashed border-default p-2.5"
    >
      <div class="flex gap-2">
        <UInput
          v-model="refundAmount"
          inputmode="decimal"
          :placeholder="$t('receipt.refundPlaceholder')"
          :aria-label="$t('receipt.newRefundAmount')"
          :color="refundError ? 'error' : undefined"
          class="flex-1"
          @keydown.enter.prevent="addRefund"
        >
          <template #trailing>
            <span class="text-xs text-muted">{{ currency }}</span>
          </template>
        </UInput>
        <UButton
          icon="i-lucide-plus"
          :label="$t('receipt.add')"
          variant="soft"
          @click="addRefund"
        />
      </div>
      <p v-if="refundError" class="text-sm text-error">{{ refundError }}</p>
    </div>
  </section>
</template>
