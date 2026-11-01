<script setup lang="ts">
import { minorUnits, newLineItemSplit, parseMoney, type Participant } from '@osi/owe-yeah-domain';
import { draftLineItem, type DraftLineItem } from '~/utils/receipt-draft';

// A Receipt's Line items as the Till list enters them, at the till: one line after the
// other, each opened in place to edit it (one at a time), with the add form at the end. A new
// Line item copies the previous one's split when it was Even, and otherwise starts Even
// across all Participants.
const { participants, currency } = defineProps<{
  participants: readonly Participant[];
  currency: string;
}>();
const lineItems = defineModel<DraftLineItem[]>({ required: true });

const { t } = useI18n();

const openKey = ref<string | null>(null);

const adding = reactive({ name: '', price: '', quantity: 1 });
const addError = ref<string | null>(null);
const priceInput = useTemplateRef('price');

function add(): void {
  if (parseMoney(adding.price, currency) === null) {
    const decimals = minorUnits(currency);
    addError.value = t('expense.amountInvalid', { decimals }, decimals);
    return;
  }
  lineItems.value = [
    ...lineItems.value,
    draftLineItem({
      name: adding.name.trim(),
      price: adding.price,
      quantity: adding.quantity,
      split: newLineItemSplit(
        lineItems.value,
        participants.map(({ id }) => id),
      ),
    }),
  ];
  Object.assign(adding, { name: '', price: '', quantity: 1 });
  addError.value = null;
  priceInput.value?.inputRef?.focus();
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
          :max="10000"
          :aria-label="$t('receipt.newQuantity')"
          class="w-32"
        />
      </div>
      <div class="flex gap-2">
        <UInput
          v-model="adding.name"
          :placeholder="$t('receipt.namePlaceholder')"
          :aria-label="$t('receipt.newName')"
          class="flex-1"
          @keydown.enter.prevent="add"
        />
        <UButton icon="i-lucide-plus" :label="$t('receipt.add')" @click="add" />
      </div>
      <p v-if="addError" class="text-sm text-error">{{ addError }}</p>
    </div>
  </section>
</template>
