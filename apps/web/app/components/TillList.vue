<script setup lang="ts">
import {
  fromMinor,
  MAX_UNITS,
  minorUnits,
  newLineItemSplit,
  parseMoney,
  type Participant,
} from '@osi/owe-yeah-domain';
import {
  draftLineItem,
  readLineItem,
  type DraftLineItem,
  type LineItemReason,
} from '~/utils/expense-draft';

// A Receipt's Line items as the Till list enters them, at the till, as one card under its
// heading: one line after the other, each opened in place to edit it (one at a time, `openKey`),
// then the add forms, each folded into a row until tapped: one for goods, with an optional
// Deposit per unit, and one for a Deposit refund. An open add form is a pending line, tinted,
// showing the split it will get and saying it isn't on the Receipt until "Add to Receipt" (or
// Discard); `pending` tells the form while one has something typed. Whatever the slot holds
// (the Receipt's sums) closes the card. New goods copy the previous goods' split when it was
// Even, and otherwise start Even across all Participants; a Deposit refund always starts Even
// across all Participants.
const { participants, currency } = defineProps<{
  participants: readonly Participant[];
  currency: string;
}>();
const lineItems = defineModel<DraftLineItem[]>({ required: true });
/** The key of the line open for editing; `null` while none is. */
const openKey = defineModel<string | null>('openKey', { default: null });
/** Whether an add form holds a line that isn't on the Receipt yet. */
const pending = defineModel<boolean>('pending', { default: false });

const { t, locale } = useI18n();
const { lineItemReason } = useDraftReasons();
const splitText = useSplitText();

// A Receipt just itemised opens on its one line, the amount carried over, as the thing to edit.
if (openKey.value === null && lineItems.value.length === 1) openKey.value = lineItems.value[0]!.key;

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

// What the line being typed comes to, Deposits included; `null` before its price reads.
const draftTotal = computed(() => {
  const price = parseMoney(adding.price, currency);
  if (price === null) return null;
  const deposit = parseMoney(adding.deposit, currency) ?? 0;
  return formatMoney(
    fromMinor((price + deposit) * adding.quantity, currency),
    currency,
    locale.value,
  );
});
const priceInput = useTemplateRef('price');

// The split new goods get, shown before they are added.
const goodsSplit = computed(() =>
  newLineItemSplit(
    lineItems.value.filter(({ refund }) => !refund),
    everyone(),
  ),
);

// Which add form is open. Each stays folded into one row until tapped, so the Receipt leads;
// the goods form opens on its price, as the till prints it.
const composing = ref<'goods' | 'refund' | null>(null);
async function compose(form: 'goods' | 'refund'): Promise<void> {
  composing.value = form;
  await nextTick();
  if (form === 'goods') priceInput.value?.focus();
}

function add(): void {
  const line = draftLineItem({
    name: adding.name.trim(),
    price: adding.price,
    quantity: adding.quantity,
    deposit: adding.deposit.trim(),
    split: goodsSplit.value,
  });
  addError.value = addRefusal(line);
  if (addError.value) return;
  lineItems.value = [...lineItems.value, line];
  Object.assign(adding, { name: '', price: '', quantity: 1, deposit: '' });
  priceInput.value?.focus();
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

watchEffect(() => {
  pending.value =
    (composing.value === 'goods' && (adding.price.trim() !== '' || adding.name.trim() !== '')) ||
    (composing.value === 'refund' && refundAmount.value.trim() !== '');
});

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

// The tint and edge of a pending line, so it can't pass for one on the Receipt.
const pendingRow =
  'space-y-3 border-t border-default bg-primary/6 px-4 pt-3 pb-4 dark:bg-primary/10';
// A folded add form.
const addRow =
  'flex min-h-14 w-full cursor-pointer items-center gap-3 border-t border-default px-4 text-start font-medium text-primary transition-colors hover:bg-elevated/50';
</script>

<template>
  <section aria-labelledby="till-list-heading">
    <h2 id="till-list-heading" class="section-heading">
      {{ $t('receipt.lineItems') }}
    </h2>
    <div class="card overflow-hidden">
      <ol v-if="lineItems.length > 0" class="divide-y divide-default">
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

      <button
        v-if="composing !== 'goods'"
        type="button"
        :class="[addRow, { 'border-t-0': lineItems.length === 0 }]"
        @click="compose('goods')"
      >
        <span class="grid size-8 place-items-center rounded-full bg-primary/10">
          <UIcon name="i-lucide-plus" class="size-4" />
        </span>
        {{ $t('receipt.addLineItem') }}
      </button>
      <div
        v-else
        role="group"
        :aria-label="$t('receipt.addLineItem')"
        :class="[pendingRow, { 'border-t-0': lineItems.length === 0 }]"
      >
        <div class="flex items-center justify-between">
          <div class="min-w-0">
            <p class="font-semibold text-highlighted">{{ $t('receipt.newLineItem') }}</p>
            <p class="text-sm text-muted">
              {{ splitText(goodsSplit, participants, currency) }}
            </p>
          </div>
          <UButton
            color="neutral"
            variant="link"
            :label="$t('receipt.closeAdding')"
            class="-me-3"
            @click="composing = null"
          />
        </div>
        <UFormField :label="$t('receipt.name')">
          <UInput
            v-model="adding.name"
            :placeholder="$t('receipt.namePlaceholder')"
            :aria-label="$t('receipt.newName')"
            class="w-full"
            @keydown.enter.prevent="add"
          />
        </UFormField>
        <div class="flex gap-2">
          <UFormField :label="$t('receipt.unitPrice')" class="min-w-0 flex-1">
            <MoneyInput
              ref="price"
              v-model="adding.price"
              :currency="currency"
              :aria-label="$t('receipt.newUnitPrice')"
              :color="addError ? 'error' : undefined"
              class="w-full"
              @keydown.enter.prevent="add"
            />
          </UFormField>
          <UFormField :label="$t('receipt.quantity')" class="w-36 shrink-0">
            <UInputNumber
              v-model="adding.quantity"
              :min="1"
              :max="MAX_UNITS"
              :increment="{ color: 'neutral', class: 'disabled:opacity-30' }"
              :decrement="{ color: 'neutral', class: 'disabled:opacity-30' }"
              :aria-label="$t('receipt.newQuantity')"
              :ui="{ base: 'h-11' }"
            />
          </UFormField>
        </div>
        <div class="flex items-end gap-2">
          <UFormField
            :label="$t('receipt.depositPerUnit')"
            :hint="$t('form.optional')"
            class="min-w-0 flex-1"
          >
            <MoneyInput
              v-model="adding.deposit"
              :currency="currency"
              :aria-label="$t('receipt.newDeposit')"
              class="w-full"
              @keydown.enter.prevent="add"
            />
          </UFormField>
          <div class="w-36 shrink-0 pb-2.5 text-end">
            <p class="text-sm text-muted">{{ $t('receipt.lineTotal') }}</p>
            <p class="text-lg font-semibold text-highlighted tabular-nums">
              {{ draftTotal ?? '–' }}
            </p>
          </div>
        </div>
        <p v-if="addError" class="text-sm text-error">{{ addError }}</p>
        <UButton icon="i-lucide-plus" :label="$t('receipt.add')" block @click="add" />
        <p class="text-center text-sm text-muted">{{ $t('receipt.pendingHelp') }}</p>
      </div>

      <button
        v-if="composing !== 'refund'"
        type="button"
        :class="addRow"
        @click="compose('refund')"
      >
        <span class="grid size-8 place-items-center rounded-full bg-primary/10">
          <UIcon name="i-lucide-undo-2" class="size-4" />
        </span>
        {{ $t('receipt.addDepositRefund') }}
      </button>
      <div v-else role="group" :aria-label="$t('receipt.addDepositRefund')" :class="pendingRow">
        <div class="flex items-center justify-between">
          <div class="min-w-0">
            <p class="font-semibold text-highlighted">{{ $t('receipt.depositRefund') }}</p>
            <p class="text-sm text-muted">
              {{ splitText({ mode: 'even', participantIds: everyone() }, participants) }}
            </p>
          </div>
          <UButton
            color="neutral"
            variant="link"
            :label="$t('receipt.closeAdding')"
            class="-me-3"
            @click="composing = null"
          />
        </div>
        <UFormField :label="$t('receipt.refundAmount')">
          <MoneyInput
            v-model="refundAmount"
            :currency="currency"
            :aria-label="$t('receipt.newRefundAmount')"
            :color="refundError ? 'error' : undefined"
            class="w-full"
            @keydown.enter.prevent="addRefund"
          />
        </UFormField>
        <p v-if="refundError" class="text-sm text-error">{{ refundError }}</p>
        <UButton icon="i-lucide-plus" :label="$t('receipt.add')" block @click="addRefund" />
        <p class="text-center text-sm text-muted">{{ $t('receipt.pendingHelp') }}</p>
      </div>

      <div v-if="$slots.default" class="border-t border-default p-4">
        <slot />
      </div>
    </div>
  </section>
</template>
