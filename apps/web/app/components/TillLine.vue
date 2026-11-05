<script setup lang="ts">
import {
  MAX_UNITS,
  fromMinor,
  lineItemProblems,
  lineItemShares,
  type Participant,
  type Rational,
  type SplitMode,
} from '@osi/owe-yeah-domain';
import {
  chooseSplitMode,
  readLineItem,
  type DraftLineItem,
  type LineItemField,
} from '~/utils/expense-draft';

// One Line item of the Till list. Collapsed, it reads as on the paper Receipt: name, quantity
// × unit price, how it is split, its Line discount, its Deposit, its total after that
// discount, and what is not assigned yet, or what of it can't be read (`readLineItem`). Open,
// it keeps only its name and total on top and is edited in place, closed again with Done
// (Line discount and Deposit per unit folded under the split until wanted): name, unit price, quantity, Line discount, Deposit per unit, Split
// mode and that mode's inputs, moving it up or down, and removing it. A Deposit refund has
// only a name, an amount and a split, and reads as a negative amount. Switching the Split mode
// starts that mode from scratch (`chooseSplitMode`).
const {
  participants,
  currency,
  position,
  first,
  last,
  discounted = false,
} = defineProps<{
  participants: readonly Participant[];
  currency: string;
  /** Whether a Receipt discount applies, which the line's own figures come before. */
  discounted?: boolean;
  /** Its place on the Receipt, from 1, to name a line without a name. */
  position: number;
  first: boolean;
  last: boolean;
}>();
const line = defineModel<DraftLineItem>('line', { required: true });
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ move: [by: -1 | 1]; remove: [] }>();

// Line discount and Deposit per unit, folded under the split until wanted: open from the
// start when the line has either.
const extrasOpen = ref(line.value.discount.value.trim() !== '' || line.value.deposit.trim() !== '');

const { t, locale } = useI18n();
const splitText = useSplitText();
const { lineItemReason } = useDraftReasons();
const editorId = useId();

const money = (amount: Rational) => formatMoney(amount, currency, locale.value);
const bare = (amount: Rational) => formatMoney(amount, currency, locale.value, 'number');

const reading = computed(() => readLineItem(line.value, currency));
const item = computed(() => reading.value.lineItem);
const shares = computed(() => item.value && lineItemShares(item.value, currency));
const problems = computed(() => (item.value ? lineItemProblems(item.value) : []));
// What of the line can't be read, while anything can't.
const unreadable = computed(() => reading.value.reasons.map(lineItemReason));
const readable = (field: LineItemField) =>
  !reading.value.reasons.some((reason) => reason.field === field);
const depositText = computed(() =>
  shares.value && shares.value.deposit.numerator !== 0n ? money(shares.value.deposit) : null,
);
const discountText = computed(
  () =>
    item.value?.discount &&
    shares.value &&
    formatDiscount(item.value.discount, shares.value.discountOff, currency, locale.value),
);
const discountError = computed(() => {
  if (!readable('discount')) return t('receipt.discountUnreadable');
  return problems.value.includes('lineDiscountExceedsLineTotal')
    ? t('receipt.problem.lineDiscountExceedsLineTotal')
    : undefined;
});
const unassigned = computed(() =>
  shares.value && shares.value.unassigned.numerator !== 0n ? shares.value.unassigned : null,
);
const name = computed(
  () =>
    line.value.name.trim() ||
    (line.value.refund ? t('receipt.depositRefund') : t('receipt.unnamed', { position })),
);
const unitPrice = computed(() =>
  item.value ? money(fromMinor(item.value.unitPrice, currency)) : line.value.price,
);

function update(change: Partial<DraftLineItem>): void {
  line.value = { ...line.value, ...change };
}

function chooseMode(mode: SplitMode): void {
  const chosen = chooseSplitMode(line.value, mode, participants);
  if (chosen !== line.value) line.value = chosen;
}

// The Participants in the Trip's order, each with what the split gives them.
const rows = computed(() => {
  const { split } = line.value;
  return participants.map((participant) => ({
    participant,
    ticked: split.mode === 'even' && split.participantIds.includes(participant.id),
    units:
      split.mode === 'units'
        ? (split.parts.find(({ participantId }) => participantId === participant.id)?.units ?? 0)
        : 0,
    amount:
      split.mode === 'amounts'
        ? (split.parts.find(({ participantId }) => participantId === participant.id)?.amount ?? '')
        : '',
  }));
});

const allTicked = computed(() => rows.value.every(({ ticked }) => ticked));

function tick(participantId: string, ticked: boolean): void {
  const ids = rows.value
    .filter(({ participant, ticked: was }) => (participant.id === participantId ? ticked : was))
    .map(({ participant }) => participant.id);
  update({ split: { mode: 'even', participantIds: ids } });
}

function toggleAll(): void {
  update({
    split: {
      mode: 'even',
      participantIds: allTicked.value ? [] : participants.map(({ id }) => id),
    },
  });
}

function setUnits(participantId: string, units: number | null): void {
  const parts = rows.value.flatMap(({ participant, units: had }) => {
    const now = participant.id === participantId ? (units ?? 0) : had;
    return now > 0 ? [{ participantId: participant.id, units: now }] : [];
  });
  update({ split: { mode: 'units', parts } });
}

function setAmount(participantId: string, amount: string): void {
  const parts = rows.value.flatMap(({ participant, amount: had }) => {
    const now = participant.id === participantId ? amount : had;
    return now.trim() === '' ? [] : [{ participantId: participant.id, amount: now }];
  });
  update({ split: { mode: 'amounts', parts } });
}

const assignedUnits = computed(() => rows.value.reduce((sum, { units }) => sum + units, 0));

const modes: readonly SplitMode[] = ['even', 'units', 'amounts'];
</script>

<template>
  <li
    class="relative"
    :class="{
      'before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-warning':
        unassigned || !item || problems.length,
    }"
  >
    <button
      type="button"
      class="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/50"
      :class="{ 'bg-elevated/50': open }"
      :aria-expanded="open"
      :aria-controls="editorId"
      @click="open = !open"
    >
      <span class="min-w-0 flex-1 leading-snug">
        <span class="block truncate font-medium text-highlighted">{{ name }}</span>
        <span v-if="!open" class="block truncate text-xs text-muted">
          {{
            line.quantity > 1
              ? $t('receipt.facts', {
                  quantity: line.quantity,
                  price: unitPrice,
                  split: splitText(line.split, participants),
                })
              : splitText(line.split, participants)
          }}
        </span>
        <span v-if="discountText && !open" class="block truncate text-xs text-muted">
          {{ $t('receipt.lineDiscountFact', { discount: discountText }) }}
        </span>
        <span v-if="depositText && !open" class="block truncate text-xs text-muted">
          {{ $t('receipt.depositFact', { deposit: depositText }) }}
        </span>
        <span v-for="text in unreadable" :key="text" class="block text-xs text-warning">
          {{ text }}
        </span>
        <span v-for="problem in problems" :key="problem" class="block text-xs text-warning">
          {{ $t(`receipt.problem.${problem}`) }}
        </span>
        <span v-if="unassigned && problems.length === 0" class="block text-xs text-warning">
          {{
            $t(discounted ? 'receipt.notAssignedBeforeDiscount' : 'receipt.notAssigned', {
              amount: money(unassigned),
            })
          }}
        </span>
      </span>
      <span class="flex shrink-0 items-center gap-1.5 font-semibold text-highlighted tabular-nums">
        {{ shares && money(shares.net) }}
        <UIcon
          name="i-lucide-chevron-down"
          class="size-4 text-dimmed transition-transform"
          :class="{ 'rotate-180': open }"
          aria-hidden="true"
        />
      </span>
    </button>

    <div v-if="open" :id="editorId" class="space-y-4 bg-elevated/50 px-4 pt-1 pb-4">
      <UFormField :label="$t('receipt.name')">
        <UInput
          :model-value="line.name"
          :placeholder="$t('receipt.namePlaceholder')"
          class="w-full"
          @update:model-value="update({ name: String($event) })"
        />
      </UFormField>
      <div class="flex gap-2">
        <UFormField
          :label="line.refund ? $t('receipt.refundAmount') : $t('receipt.unitPrice')"
          class="flex-1"
        >
          <UInput
            :model-value="line.price"
            inputmode="decimal"
            class="w-full"
            :color="readable(line.refund ? 'amount' : 'price') ? undefined : 'error'"
            @update:model-value="update({ price: String($event) })"
          >
            <template #trailing>
              <span class="text-xs text-muted">{{ currency }}</span>
            </template>
          </UInput>
        </UFormField>
        <UFormField v-if="!line.refund" :label="$t('receipt.quantity')" class="w-32">
          <UInputNumber
            :model-value="line.quantity"
            :min="1"
            :max="MAX_UNITS"
            @update:model-value="update({ quantity: Math.max(1, $event ?? 1) })"
          />
        </UFormField>
      </div>
      <p v-if="line.refund" class="text-sm text-muted">{{ $t('receipt.refundHelp') }}</p>
      <p v-else class="-mt-2 text-sm text-muted">{{ $t('receipt.weighedHelp') }}</p>

      <SegmentedControl
        :model-value="line.split.mode"
        :options="modes.map((mode) => ({ value: mode, label: $t(`receipt.mode.${mode}`) }))"
        :label="$t('receipt.splitMode')"
        class="flex w-full"
        @update:model-value="chooseMode"
      />

      <div v-if="line.split.mode === 'even'" role="group" :aria-label="$t('expense.forWhom')">
        <div class="mb-2 flex justify-end">
          <UButton
            variant="soft"
            size="xs"
            :label="$t('expense.all')"
            :aria-pressed="allTicked"
            class="px-2.5"
            @click="toggleAll"
          />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <ParticipantChip
            v-for="row in rows"
            :key="row.participant.id"
            :participant="row.participant"
            type="checkbox"
            :name="`even-${line.key}`"
            :checked="row.ticked"
            @update:checked="tick(row.participant.id, $event)"
          />
        </div>
      </div>

      <ul v-else class="space-y-2">
        <li v-for="row in rows" :key="row.participant.id" class="flex items-center gap-3">
          <ParticipantAvatar :participant="row.participant" size="sm" />
          <span class="min-w-0 flex-1 truncate">{{ row.participant.name }}</span>
          <UInputNumber
            v-if="line.split.mode === 'units'"
            :model-value="row.units"
            :min="0"
            :max="line.quantity - assignedUnits + row.units"
            :aria-label="$t('receipt.unitsFor', { name: row.participant.name })"
            class="w-32"
            @update:model-value="setUnits(row.participant.id, $event ?? 0)"
          />
          <UInput
            v-else
            :model-value="row.amount"
            inputmode="decimal"
            placeholder="0"
            :aria-label="$t('receipt.amountFor', { name: row.participant.name })"
            class="w-32"
            @update:model-value="setAmount(row.participant.id, String($event))"
          />
        </li>
        <li v-if="line.split.mode === 'units'" class="text-sm text-muted">
          {{ $t('receipt.unitsAssigned', { assigned: assignedUnits, quantity: line.quantity }) }}
        </li>
      </ul>

      <template v-if="!line.refund">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center justify-between gap-2 border-t border-default pt-3 text-sm font-medium text-default"
          :aria-expanded="extrasOpen"
          :aria-controls="`${editorId}-extras`"
          @click="extrasOpen = !extrasOpen"
        >
          {{ $t('receipt.extras') }}
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 text-dimmed transition-transform"
            :class="{ 'rotate-180': extrasOpen }"
          />
        </button>
        <div v-if="extrasOpen" :id="`${editorId}-extras`" class="space-y-4">
          <div>
            <DiscountField
              :model-value="line.discount"
              :label="$t('receipt.lineDiscount')"
              :currency="currency"
              :error="discountError"
              @update:model-value="update({ discount: $event })"
            />
            <p class="mt-2 text-sm text-muted">{{ $t('receipt.perUnitDiscountHelp') }}</p>
          </div>

          <UFormField
            :label="$t('receipt.depositPerUnit')"
            :help="$t('receipt.depositHelp')"
            :error="readable('deposit') ? undefined : $t('receipt.depositUnreadable')"
          >
            <UInput
              :model-value="line.deposit"
              inputmode="decimal"
              placeholder="0"
              class="w-full"
              @update:model-value="update({ deposit: String($event) })"
            >
              <template #trailing>
                <span class="text-xs text-muted">{{ currency }}</span>
              </template>
            </UInput>
          </UFormField>
        </div>
      </template>

      <div class="flex items-center gap-1 border-t border-default pt-3">
        <UButton
          v-if="!(first && last)"
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="ghost"
          :disabled="first"
          :aria-label="$t('receipt.moveUp')"
          @click="emit('move', -1)"
        />
        <UButton
          v-if="!(first && last)"
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="ghost"
          :disabled="last"
          :aria-label="$t('receipt.moveDown')"
          @click="emit('move', 1)"
        />
        <UButton
          :label="$t('receipt.remove')"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          class="ms-auto"
          @click="emit('remove')"
        />
        <UButton :label="$t('receipt.done')" variant="soft" @click="open = false" />
      </div>
    </div>
  </li>
</template>
