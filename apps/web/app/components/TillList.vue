<script setup lang="ts">
import { MAX_UNITS, minorUnits, newLineItemSplit, type Participant } from '@osi/owe-yeah-domain';
import {
  draftLineItem,
  readLineItem,
  type DraftLineItem,
  type LineItemReason,
} from '~/utils/expense-draft';

// A Receipt's Line items as the Till list enters them, at the till: one line after the
// other, each opened in place to edit it (one at a time), with the add forms at the end, each
// folded into a row until tapped: one for goods, with an optional Deposit per unit, and one
// for a Deposit refund. New goods copy
// the previous goods' split when it was Even, and otherwise start Even across all
// Participants; a Deposit refund always starts Even across all Participants.
const {
  participants,
  currency,
  discounted = false,
} = defineProps<{
  participants: readonly Participant[];
  currency: string;
  /** Whether a Receipt discount applies (`TillLine`). */
  discounted?: boolean;
}>();
const lineItems = defineModel<DraftLineItem[]>({ required: true });

const { t } = useI18n();
const { lineItemReason } = useDraftReasons();

// A Receipt just itemised opens on its one line, the amount carried over, as the thing to edit.
const openKey = ref<string | null>(lineItems.value.length === 1 ? lineItems.value[0]!.key : null);

const everyone = () => participants.map(({ id }) => id);

/**
 * Why a Line item about to be added can't be (`readLineItem`), as the add forms say it: an
 * amount it can't read asks for one in the currency's decimals; `null` when it can be added.
 */
function addRefusal(line: DraftLineItem): string | null {
  const [reason]: LineItemReason[] = readLineItem(line, currency).reasons;
  if (!reason) return null;
  if (reason.field !== 'price' && reason.field !== 'amount') return lineItemReason(reason);
  const decimals = minorUnits(currency);
  return t('expense.amountInvalid', { decimals }, decimals);
}

const adding = reactive({ name: '', price: '', quantity: 1, deposit: '' });
const addError = ref<string | null>(null);
const priceInput = useTemplateRef('price');

// Which add form is open. Each stays folded into one row until tapped, so the Receipt leads;
// the goods form opens on its price, as the till prints it.
const composing = ref<'goods' | 'refund' | null>(null);
async function compose(form: 'goods' | 'refund'): Promise<void> {
  composing.value = form;
  await nextTick();
  if (form === 'goods') priceInput.value?.inputRef?.focus();
}

function add(): void {
  const line = draftLineItem({
    name: adding.name.trim(),
    price: adding.price,
    quantity: adding.quantity,
    deposit: adding.deposit.trim(),
    split: newLineItemSplit(
      lineItems.value.filter(({ refund }) => !refund),
      everyone(),
    ),
  });
  addError.value = addRefusal(line);
  if (addError.value) return;
  lineItems.value = [...lineItems.value, line];
  Object.assign(adding, { name: '', price: '', quantity: 1, deposit: '' });
  priceInput.value?.inputRef?.focus();
}

const refundAmount = ref('');
const refundError = ref<string | null>(null);

function addRefund(): void {
  const line = draftLineItem({
    name: '',
    price: refundAmount.value,
    quantity: 1,
    refund: true,
    split: { mode: 'even', participantIds: everyone() },
  });
  refundError.value = addRefusal(line);
  if (refundError.value) return;
  lineItems.value = [...lineItems.value, line];
  refundAmount.value = '';
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
    <h2 id="till-list-heading" class="text-sm font-medium text-highlighted">
      {{ $t('receipt.lineItems') }}
    </h2>
    <div class="overflow-hidden rounded-xl ring ring-default">
      <ol v-if="lineItems.length > 0" class="divide-y divide-default">
        <TillLine
          v-for="(line, index) in lineItems"
          :key="line.key"
          :line="line"
          :open="openKey === line.key"
          :participants="participants"
          :currency="currency"
          :discounted="discounted"
          :position="index + 1"
          :first="index === 0"
          :last="index === lineItems.length - 1"
          @update:line="replace(index, $event)"
          @update:open="openKey = $event ? line.key : null"
          @move="move(index, $event)"
          @remove="remove(index)"
        />
      </ol>

      <button
        v-if="composing !== 'goods'"
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start font-medium text-primary transition-colors hover:bg-elevated/50"
        :class="{ 'border-t border-default': lineItems.length > 0 }"
        @click="compose('goods')"
      >
        <span class="grid size-7 place-items-center rounded-full bg-primary/10">
          <UIcon name="i-lucide-plus" class="size-4" />
        </span>
        {{ $t('receipt.addLineItem') }}
      </button>
      <div
        v-else
        role="group"
        :aria-label="$t('receipt.addLineItem')"
        class="space-y-2 bg-elevated/40 p-3"
        :class="{ 'border-t border-default': lineItems.length > 0 }"
      >
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted">{{ $t('receipt.addLineItem') }}</p>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="$t('receipt.closeAdding')"
            @click="composing = null"
          />
        </div>
        <UInput
          v-model="adding.name"
          :placeholder="$t('receipt.namePlaceholder')"
          :aria-label="$t('receipt.newName')"
          size="lg"
          class="w-full"
          @keydown.enter.prevent="add"
        />
        <div class="flex gap-2">
          <UInput
            ref="price"
            v-model="adding.price"
            inputmode="decimal"
            :placeholder="$t('receipt.unitPrice')"
            :aria-label="$t('receipt.newUnitPrice')"
            :color="addError ? 'error' : undefined"
            size="lg"
            class="min-w-0 flex-1"
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
            size="lg"
            class="w-32"
          />
        </div>
        <div class="flex gap-2">
          <UInput
            v-model="adding.deposit"
            inputmode="decimal"
            :placeholder="$t('receipt.depositPlaceholder')"
            :aria-label="$t('receipt.newDeposit')"
            size="lg"
            class="min-w-0 flex-1"
            @keydown.enter.prevent="add"
          >
            <template #trailing>
              <span class="text-xs text-muted">{{ currency }}</span>
            </template>
          </UInput>
          <UButton
            icon="i-lucide-plus"
            :label="$t('receipt.add')"
            variant="soft"
            size="lg"
            class="w-28 justify-center"
            @click="add"
          />
        </div>
        <p v-if="addError" class="text-sm text-error">{{ addError }}</p>
      </div>

      <button
        v-if="composing !== 'refund'"
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start font-medium text-primary transition-colors hover:bg-elevated/50 border-t border-default"
        @click="compose('refund')"
      >
        <span class="grid size-7 place-items-center rounded-full bg-primary/10">
          <UIcon name="i-lucide-undo-2" class="size-4" />
        </span>
        {{ $t('receipt.addDepositRefund') }}
      </button>
      <div
        v-else
        role="group"
        :aria-label="$t('receipt.addDepositRefund')"
        class="space-y-2 border-t border-default bg-elevated/40 p-3"
      >
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted">{{ $t('receipt.addDepositRefund') }}</p>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="$t('receipt.closeAdding')"
            @click="composing = null"
          />
        </div>
        <div class="flex gap-2">
          <UInput
            v-model="refundAmount"
            inputmode="decimal"
            :placeholder="$t('receipt.refundPlaceholder')"
            :aria-label="$t('receipt.newRefundAmount')"
            :color="refundError ? 'error' : undefined"
            size="lg"
            class="min-w-0 flex-1"
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
            size="lg"
            class="w-28 justify-center"
            @click="addRefund"
          />
        </div>
        <p v-if="refundError" class="text-sm text-error">{{ refundError }}</p>
      </div>
    </div>
  </section>
</template>
