<script setup lang="ts">
import {
  MAX_UNITS,
  fromMinor,
  lineItemProblems,
  lineItemShares,
  negate,
  parseMoney,
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

// One Line item of the Till list, a row of its card. Folded, it reads as on the paper Receipt,
// in full rather than cut short: name, quantity × unit price, how it is split, its Line
// discount and Deposit, its total after that discount, and what is not assigned yet (by units
// and their value where it has them, as on the detail page), or what of it can't be read
// (`readLineItem`). A Deposit refund is marked so. Open, its header keeps only its "Line total"
// (the name is in the field below) and it is edited in place, closed again with Done: name, unit
// price, quantity, Split mode and that mode's inputs ("you" marked) with how much of the line
// they assign, then the Line discount and Deposit per unit (folded until wanted), moving it up
// or down, and removing it. A Deposit refund has only a name, an amount and a split, and reads
// as a negative amount. Switching the Split mode starts that mode from scratch
// (`chooseSplitMode`). Its `id` lets the Receipt total point at it.
const {
  participants,
  currency,
  after = null,
  position,
  first,
  last,
} = defineProps<{
  participants: readonly Participant[];
  currency: string;
  /**
   * What the Receipt's unassigned value comes to after its Receipt discount, when it is all on
   * this line, to say after its own (`useUnassignedText`).
   */
  after?: Rational | null;
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
const { claim } = useOpenTrip();
const splitText = useSplitText();
const unassignedText = useUnassignedText();
const discountText = useDiscountText();
const { lineItemReason } = useDraftReasons();
const editorId = useId();

const money = (amount: Rational) => formatMoney(amount, currency, locale.value);

const reading = computed(() => readLineItem(line.value, currency));
const item = computed(() => reading.value.lineItem);
const shares = computed(() => item.value && lineItemShares(item.value, currency));
const problems = computed(() => (item.value ? lineItemProblems(item.value) : []));
// What of the line can't be read, while anything can't.
const unreadable = computed(() => reading.value.reasons.map(lineItemReason));
const readable = (field: LineItemField) =>
  !reading.value.reasons.some((reason) => reason.field === field);
const discountError = computed(() => {
  if (!readable('discount')) return t('receipt.discountUnreadable');
  return problems.value.includes('lineDiscountExceedsLineTotal')
    ? t('receipt.problem.lineDiscountExceedsLineTotal')
    : undefined;
});
const unassigned = computed(() =>
  shares.value && shares.value.unassigned.numerator !== 0n ? shares.value.unassigned : null,
);
// What of it is not assigned yet, by units where it has them ("1 of 4 units unassigned").
const missing = computed(() =>
  item.value && shares.value
    ? unassignedText(item.value, shares.value, currency, { withValue: true, after })
    : null,
);
const name = computed(
  () =>
    line.value.name.trim() ||
    (line.value.refund ? t('receipt.depositRefund') : t('receipt.unnamed', { position })),
);
const unitPrice = computed(() =>
  item.value ? money(fromMinor(item.value.unitPrice, currency)) : line.value.price,
);

// The folded line's facts under its name: how it is split, then its discount and Deposit.
const facts = computed(() => {
  const split = splitText(line.value.split, participants, currency);
  const extras = [
    item.value?.discount &&
      shares.value &&
      discountText(item.value.discount, shares.value.discountOff, currency, true),
    shares.value &&
      shares.value.deposit.numerator !== 0n &&
      t('receipt.depositFact', { deposit: money(shares.value.deposit) }),
  ].filter((fact) => fact !== false && fact !== null && fact !== undefined && fact !== '');
  return {
    split:
      line.value.quantity > 1
        ? t('receipt.facts', { quantity: line.value.quantity, price: unitPrice.value, split })
        : split,
    extras: extras.join(' · '),
  };
});

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

// "Select all" ticks everyone, or "Clear" unticks everyone when everyone is ticked already.
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

// How much of the line's full price the Amounts give out, as "€10.00 of €14.50"; `null` while
// an Amount or the price can't be read.
const assignedAmounts = computed(() => {
  if (!shares.value) return null;
  let minor = 0;
  for (const { amount } of rows.value) {
    if (amount.trim() === '') continue;
    const parsed = parseMoney(amount, currency);
    if (parsed === null) return null;
    minor += parsed;
  }
  const total = shares.value.total;
  return {
    text: t('receipt.amountsAssigned', {
      assigned: money(fromMinor(minor, currency)),
      total: money(total.numerator < 0n ? negate(total) : total),
    }),
    complete: unassigned.value === null,
  };
});

const modes: readonly SplitMode[] = ['even', 'units', 'amounts'];

// One look for every stepper: − and + alike, and plainly off at the limit.
const step = { color: 'neutral', class: 'disabled:opacity-30' } as const;
</script>

<template>
  <li
    :id="`line-${line.key}`"
    class="relative scroll-mt-20"
    :class="{
      'before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-e-full before:bg-warning':
        unassigned || !item || problems.length,
    }"
  >
    <button
      type="button"
      class="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-start transition-colors hover:bg-elevated/50"
      :class="{ 'bg-elevated/60': open }"
      :aria-expanded="open"
      :aria-controls="editorId"
      @click="open = !open"
    >
      <span class="min-w-0 flex-1 leading-snug">
        <span class="block font-medium break-words text-highlighted" :class="{ 'sr-only': open }">
          {{ name }}
        </span>
        <span v-if="open" class="block text-sm text-muted" aria-hidden="true">
          {{ $t('receipt.lineTotal') }}
        </span>
        <template v-if="!open">
          <span class="mt-0.5 block text-sm text-muted">
            <UIcon
              v-if="line.refund"
              name="i-lucide-undo-2"
              class="me-1 size-3.5 align-[-0.125em]"
              aria-hidden="true"
            />
            {{ line.refund ? `${$t('receipt.depositRefund')} · ${facts.split}` : facts.split }}
          </span>
          <span v-if="facts.extras" class="block text-sm text-muted">{{ facts.extras }}</span>
        </template>
        <span v-for="text in unreadable" :key="text" class="mt-0.5 block text-sm text-warning">
          {{ text }}
        </span>
        <span v-for="problem in problems" :key="problem" class="mt-0.5 block text-sm text-warning">
          {{ $t(`receipt.problem.${problem}`) }}
        </span>
        <span
          v-if="missing && problems.length === 0"
          class="mt-0.5 flex items-center gap-1 text-sm font-medium text-warning"
        >
          <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" aria-hidden="true" />
          {{ missing }}
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

    <div v-if="open" :id="editorId" class="space-y-3 bg-elevated/60 px-4 pt-0.5 pb-3">
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
          class="min-w-0 flex-1"
        >
          <template v-if="line.refund" #hint>
            <HelpTip :label="$t('receipt.depositRefund')" :text="$t('receipt.refundHelp')" />
          </template>
          <MoneyInput
            :model-value="line.price"
            :currency="currency"
            :color="readable(line.refund ? 'amount' : 'price') ? undefined : 'error'"
            class="w-full"
            @update:model-value="update({ price: $event })"
          />
        </UFormField>
        <UFormField v-if="!line.refund" :label="$t('receipt.quantity')" class="w-36 shrink-0">
          <template #hint>
            <HelpTip :label="$t('receipt.quantity')" :text="$t('receipt.weighedHelp')" />
          </template>
          <UInputNumber
            :model-value="line.quantity"
            :min="1"
            :max="MAX_UNITS"
            :increment="step"
            :decrement="step"
            :ui="{ base: 'h-11' }"
            @update:model-value="update({ quantity: Math.max(1, $event ?? 1) })"
          />
        </UFormField>
      </div>

      <SegmentedControl
        :model-value="line.split.mode"
        :options="modes.map((mode) => ({ value: mode, label: $t(`receipt.mode.${mode}`) }))"
        :label="$t('receipt.splitMode')"
        class="flex w-full"
        @update:model-value="chooseMode"
      />

      <div v-if="line.split.mode === 'even'" role="group" :aria-label="$t('expense.forWhom')">
        <div class="-mt-2 mb-1 flex justify-end">
          <UButton
            variant="link"
            :label="allTicked ? $t('expense.clearAll') : $t('expense.selectAll')"
            class="-me-4"
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
          <ParticipantAvatar :participant="row.participant" size="xs" />
          <span class="flex min-w-0 flex-1 items-center text-sm font-medium">
            <span class="truncate">{{ row.participant.name }}</span>
            <YouBadge v-if="row.participant.id === claim?.id" />
          </span>
          <UInputNumber
            v-if="line.split.mode === 'units'"
            :model-value="row.units"
            :min="0"
            :max="line.quantity - assignedUnits + row.units"
            :increment="step"
            :decrement="step"
            :aria-label="$t('receipt.unitsFor', { name: row.participant.name })"
            class="w-36"
            :ui="{ base: 'h-11' }"
            @update:model-value="setUnits(row.participant.id, $event ?? 0)"
          />
          <MoneyInput
            v-else
            :model-value="row.amount"
            :currency="currency"
            :aria-label="$t('receipt.amountFor', { name: row.participant.name })"
            class="w-36"
            @update:model-value="setAmount(row.participant.id, $event)"
          />
        </li>
        <li
          v-if="line.split.mode === 'units'"
          class="flex items-center justify-end gap-1.5 pt-1 text-sm tabular-nums"
          :class="assignedUnits === line.quantity ? 'text-muted' : 'font-medium text-warning'"
        >
          <UIcon v-if="assignedUnits === line.quantity" name="i-lucide-check" class="size-4" />
          {{ $t('receipt.unitsAssigned', { assigned: assignedUnits, quantity: line.quantity }) }}
        </li>
        <li
          v-else-if="assignedAmounts"
          class="flex items-center justify-end gap-1.5 pt-1 text-sm tabular-nums"
          :class="assignedAmounts.complete ? 'text-muted' : 'font-medium text-warning'"
        >
          <UIcon v-if="assignedAmounts.complete" name="i-lucide-check" class="size-4" />
          {{ assignedAmounts.text }}
        </li>
      </ul>

      <template v-if="!line.refund">
        <button
          type="button"
          class="-mx-4 flex min-h-11 w-[calc(100%+2rem)] cursor-pointer items-center gap-2 border-t border-default px-4 text-start text-sm font-medium text-default"
          :aria-expanded="extrasOpen"
          :aria-controls="`${editorId}-extras`"
          @click="extrasOpen = !extrasOpen"
        >
          <span class="flex-1">{{ $t('receipt.extras') }}</span>
          <span class="font-normal text-muted">{{ $t('form.optional') }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 text-dimmed transition-transform"
            :class="{ 'rotate-180': extrasOpen }"
          />
        </button>
        <div v-if="extrasOpen" :id="`${editorId}-extras`" class="-mt-1 space-y-3">
          <DiscountField
            :model-value="line.discount"
            :label="$t('receipt.lineDiscount')"
            :currency="currency"
            :help="line.quantity > 1 ? $t('receipt.perUnitDiscountHelp') : undefined"
            :optional="false"
            :error="discountError"
            @update:model-value="update({ discount: $event })"
          />

          <UFormField
            :label="$t('receipt.depositPerUnit')"
            :error="readable('deposit') ? undefined : $t('receipt.depositUnreadable')"
          >
            <template #hint>
              <HelpTip :label="$t('receipt.depositPerUnit')" :text="$t('receipt.depositHelp')" />
            </template>
            <MoneyInput
              :model-value="line.deposit"
              :currency="currency"
              class="w-full"
              @update:model-value="update({ deposit: $event })"
            />
          </UFormField>
        </div>
      </template>

      <div class="-mx-4 flex items-center gap-1 border-t border-default px-2 pt-3">
        <UButton
          v-if="!(first && last)"
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="ghost"
          square
          :disabled="first"
          :aria-label="$t('receipt.moveUp')"
          @click="emit('move', -1)"
        />
        <UButton
          v-if="!(first && last)"
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="ghost"
          square
          :disabled="last"
          :aria-label="$t('receipt.moveDown')"
          @click="emit('move', 1)"
        />
        <UButton
          :label="$t('receipt.remove')"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          @click="emit('remove')"
        />
        <UButton
          :label="$t('receipt.done')"
          color="neutral"
          variant="soft"
          class="ms-auto me-2 px-6"
          @click="open = false"
        />
      </div>
    </div>
  </li>
</template>
