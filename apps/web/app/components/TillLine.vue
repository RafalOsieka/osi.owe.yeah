<script setup lang="ts">
import {
  fromMinor,
  lineItemProblem,
  lineItemShares,
  splitFromScratch,
  type Participant,
  type Rational,
  type SplitMode,
} from '@osi/owe-yeah-domain';
import { lineItemFromDraft, type DraftLineItem, type DraftSplit } from '~/utils/receipt-draft';

// One Line item of the Till list. Collapsed, it reads as on the paper Receipt: name, quantity
// × unit price, how it is split, its total, and what is not assigned yet. Open, it is edited
// in place: name, unit price, quantity, Split mode and that mode's inputs, moving it up or
// down, and removing it. Switching the Split mode starts that mode from scratch.
const { participants, currency, position, first, last } = defineProps<{
  participants: readonly Participant[];
  currency: string;
  /** Its place on the Receipt, from 1, to name a line without a name. */
  position: number;
  first: boolean;
  last: boolean;
}>();
const line = defineModel<DraftLineItem>('line', { required: true });
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ move: [by: -1 | 1]; remove: [] }>();

const { t, locale } = useI18n();
const splitText = useSplitText();
const editorId = useId();

const money = (amount: Rational) => formatMoney(amount, currency, locale.value);
const bare = (amount: Rational) => formatMoney(amount, currency, locale.value, 'number');

const item = computed(() => lineItemFromDraft(line.value, currency));
const shares = computed(() => item.value && lineItemShares(item.value, currency));
const problem = computed(() => item.value && lineItemProblem(item.value));
const unassigned = computed(() =>
  shares.value && shares.value.unassigned.numerator !== 0n ? shares.value.unassigned : null,
);
const name = computed(() => line.value.name.trim() || t('receipt.unnamed', { position }));
const unitPrice = computed(() =>
  item.value ? bare(fromMinor(item.value.unitPrice, currency)) : line.value.price,
);

function update(change: Partial<DraftLineItem>): void {
  line.value = { ...line.value, ...change };
}

function setSplit(split: DraftSplit): void {
  update({ split });
}

function chooseMode(mode: SplitMode): void {
  if (mode === line.value.split.mode) return;
  setSplit(
    splitFromScratch(
      mode,
      participants.map(({ id }) => id),
    ),
  );
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
  setSplit({ mode: 'even', participantIds: ids });
}

function toggleAll(): void {
  setSplit({
    mode: 'even',
    participantIds: allTicked.value ? [] : participants.map(({ id }) => id),
  });
}

function setUnits(participantId: string, units: number | null): void {
  const parts = rows.value.flatMap(({ participant, units: had }) => {
    const now = participant.id === participantId ? (units ?? 0) : had;
    return now > 0 ? [{ participantId: participant.id, units: now }] : [];
  });
  setSplit({ mode: 'units', parts });
}

function setAmount(participantId: string, amount: string): void {
  const parts = rows.value.flatMap(({ participant, amount: had }) => {
    const now = participant.id === participantId ? amount : had;
    return now.trim() === '' ? [] : [{ participantId: participant.id, amount: now }];
  });
  setSplit({ mode: 'amounts', parts });
}

const assignedUnits = computed(() => rows.value.reduce((sum, { units }) => sum + units, 0));

const modes: readonly SplitMode[] = ['even', 'units', 'amounts'];
</script>

<template>
  <li
    class="rounded-lg border"
    :class="unassigned || !item || problem ? 'border-warning/60' : 'border-default'"
  >
    <button
      type="button"
      class="flex w-full cursor-pointer items-start gap-2 p-2.5 text-start"
      :aria-expanded="open"
      :aria-controls="editorId"
      @click="open = !open"
    >
      <span class="min-w-0 flex-1 leading-snug">
        <span class="block truncate font-semibold">{{ name }}</span>
        <span class="block truncate text-xs text-muted">
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
        <span v-if="!item" class="block text-xs text-warning">{{ $t('receipt.checkPrice') }}</span>
        <span v-else-if="problem" class="block text-xs text-warning">
          {{ $t(`receipt.problem.${problem}`) }}
        </span>
        <span v-else-if="unassigned" class="block text-xs text-warning">
          {{ $t('receipt.notAssigned', { amount: money(unassigned) }) }}
        </span>
      </span>
      <span class="shrink-0 font-semibold tabular-nums">
        {{ shares && money(shares.total) }}
      </span>
    </button>

    <div v-if="open" :id="editorId" class="space-y-3 border-t border-default p-2.5">
      <UFormField :label="$t('receipt.name')">
        <UInput
          :model-value="line.name"
          :placeholder="$t('receipt.namePlaceholder')"
          class="w-full"
          @update:model-value="update({ name: String($event) })"
        />
      </UFormField>
      <div class="flex gap-2">
        <UFormField :label="$t('receipt.unitPrice')" class="flex-1">
          <UInput
            :model-value="line.price"
            inputmode="decimal"
            class="w-full"
            :color="item ? undefined : 'error'"
            @update:model-value="update({ price: String($event) })"
          >
            <template #trailing>
              <span class="text-xs text-muted">{{ currency }}</span>
            </template>
          </UInput>
        </UFormField>
        <UFormField :label="$t('receipt.quantity')" class="w-32">
          <UInputNumber
            :model-value="line.quantity"
            :min="1"
            :max="10000"
            @update:model-value="update({ quantity: Math.max(1, $event ?? 1) })"
          />
        </UFormField>
      </div>
      <p class="text-xs text-muted">{{ $t('receipt.weighedHelp') }}</p>

      <div role="group" :aria-label="$t('receipt.splitMode')">
        <UFieldGroup class="w-full">
          <UButton
            v-for="mode in modes"
            :key="mode"
            :label="$t(`receipt.mode.${mode}`)"
            :aria-pressed="line.split.mode === mode"
            :variant="line.split.mode === mode ? 'solid' : 'outline'"
            color="neutral"
            size="sm"
            class="flex-1 justify-center"
            @click="chooseMode(mode)"
          />
        </UFieldGroup>
      </div>

      <div v-if="line.split.mode === 'even'" role="group" :aria-label="$t('expense.forWhom')">
        <div class="mb-1.5 flex justify-end">
          <UButton
            variant="link"
            size="sm"
            :label="$t('expense.all')"
            :aria-pressed="allTicked"
            class="p-0"
            @click="toggleAll"
          />
        </div>
        <div class="flex flex-wrap gap-1.5">
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

      <ul v-else class="space-y-1.5">
        <li v-for="row in rows" :key="row.participant.id" class="flex items-center gap-2">
          <ParticipantAvatar :participant="row.participant" size="2xs" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ row.participant.name }}</span>
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
        <li v-if="line.split.mode === 'units'" class="text-xs text-muted">
          {{ $t('receipt.unitsAssigned', { assigned: assignedUnits, quantity: line.quantity }) }}
        </li>
      </ul>

      <div class="flex items-center gap-1">
        <UButton
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="first"
          :aria-label="$t('receipt.moveUp')"
          @click="emit('move', -1)"
        />
        <UButton
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="last"
          :aria-label="$t('receipt.moveDown')"
          @click="emit('move', 1)"
        />
        <UButton
          :label="$t('receipt.remove')"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="sm"
          class="ms-auto"
          @click="emit('remove')"
        />
      </div>
    </div>
  </li>
</template>
