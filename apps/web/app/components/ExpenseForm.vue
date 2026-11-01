<script setup lang="ts">
import {
  deviceTimeZone,
  expenseTimeFromLocal,
  expenseTitleSchema,
  fromMinor,
  isReceipt,
  localDateTime,
  minorUnits,
  parseMoney,
  receiptDiscountExceeds,
  receiptShares,
  roundMoney,
  type LineItem,
  type SplitExpense,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import type { RouteLocationRaw } from 'vue-router';
import { v7 as uuidv7 } from 'uuid';
import type { LocalExpense } from '~/sync/local-trip';
import {
  discountFromDraft,
  draftFromDiscount,
  draftFromLineItem,
  draftLineItem,
  lineItemFromDraft,
  noDiscount,
  type DraftDiscount,
  type DraftLineItem,
} from '~/utils/receipt-draft';

// The full-screen Expense form, for a new plain Expense or Income or to edit one: amount,
// whether it is money received (Income, saved with a negative amount so nobody types a minus),
// title, Main payer (who received it, for Income), who it is for, and when. "Itemise as a
// Receipt" grows the one Line item into the Till list on the same page: the amount becomes the
// computed Receipt total, each Line item has its own split and Line discount, and a Receipt
// discount below "Paid by" comes off them all. A Receipt may be saved with
// value not assigned yet, which counts as the Main payer's until it is. Saving keeps the
// Expense's full new state on the device, to sync later, and returns to `parent`'s screen, or
// wherever the form was opened from. An Expense that breaks a Trip rule is not saved; why
// shows above Save.
const { expense = null, parent } = defineProps<{
  expense?: Extract<LocalExpense, SplitExpense> | null;
  /** The screen above the form, for back when it was opened from a link. */
  parent: RouteLocationRaw;
}>();

const { trip, claim, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const back = useBack();

type ExpenseFormState = {
  title: string;
  /** The amount as typed, never negative. */
  amount: string;
  /** Income: money received rather than paid. */
  received: boolean;
  mainPayerId: string;
  participantIds: string[];
  /** Local date and time (`YYYY-MM-DDTHH:mm`) in `zone`. */
  local: string;
  zone: string;
  /** The Till list's Line items once itemised as a Receipt; `null` for a plain Expense. */
  lineItems: DraftLineItem[] | null;
  /** The Receipt discount, used once itemised. */
  discount: DraftDiscount;
};

// Read once: the form is mounted afresh each time it opens.
function initialState(): ExpenseFormState {
  const { participants } = trip.value;
  const everyone = participants.map(({ id }) => id);
  if (expense) {
    const [lineItem] = expense.lineItems;
    const price = lineItem!.unitPrice;
    const time = { local: localDateTime(expense.time), zone: expense.time.zone };
    const shared = { title: expense.title, mainPayerId: expense.mainPayerId, ...time };
    if (isReceipt(expense)) {
      return {
        ...shared,
        amount: '',
        received: false,
        participantIds: everyone,
        lineItems: expense.lineItems.map((item) => draftFromLineItem(item, expense.currency)),
        discount: draftFromDiscount(expense.discount, expense.currency),
      };
    }
    return {
      ...shared,
      amount: roundMoney(fromMinor(Math.abs(price), expense.currency), expense.currency).decimal,
      received: price < 0,
      participantIds: lineItem!.split.mode === 'even' ? [...lineItem!.split.participantIds] : [],
      lineItems: null,
      discount: noDiscount(),
    };
  }
  const zone = deviceTimeZone();
  const claimed = participants.find(({ id }) => id === claim.value?.id);
  return {
    title: '',
    amount: '',
    received: false,
    mainPayerId: claimed?.id ?? participants[0]?.id ?? '',
    participantIds: everyone,
    local: localDateTime({ instant: new Date().toISOString(), zone }),
    zone,
    lineItems: null,
    discount: noDiscount(),
  };
}

const state = reactive(initialState());
const id = expense?.id ?? uuidv7();

const allTicked = computed(() => state.participantIds.length === trip.value.participants.length);

function tick(participantId: string, ticked: boolean): void {
  state.participantIds = ticked
    ? [...state.participantIds, participantId]
    : state.participantIds.filter((other) => other !== participantId);
}

// "All" ticks everyone, or clears the field when everyone is ticked already.
function toggleAll(): void {
  state.participantIds = allTicked.value ? [] : trip.value.participants.map(({ id }) => id);
}

// Ticked Participants in the Trip's order, whatever order they were ticked in.
function tickedInTripOrder(): string[] {
  const ticked = new Set(state.participantIds);
  return trip.value.participants.map(({ id }) => id).filter((id) => ticked.has(id));
}

// The amount typed so far becomes the Receipt's first Line item, split as ticked.
function itemise(): void {
  state.lineItems =
    parseMoney(state.amount, trip.value.currency) === null
      ? []
      : [
          draftLineItem({
            name: '',
            price: state.amount,
            quantity: 1,
            split: { mode: 'even', participantIds: tickedInTripOrder() },
          }),
        ];
}

// The Receipt as typed so far: its Line items (`null` where one can't be read yet), its
// Receipt discount (`null` while it can't be read), and what the readable ones come to: the
// computed total, what the discount takes off, and the value not assigned to anyone yet.
const receipt = computed(() => {
  if (!state.lineItems) return null;
  const { currency } = trip.value;
  const items = state.lineItems.map((draft) => lineItemFromDraft(draft, currency));
  const discount = discountFromDraft(state.discount, currency);
  // What can be read so far, as the domain sees a Receipt.
  const readable = {
    lineItems: items.flatMap((item) => (item ? [item] : [])),
    discount: discount ?? undefined,
    currency,
  };
  const shares = receiptShares(readable);
  return {
    items,
    discount,
    total: shares.total,
    off: shares.discountOff,
    unassigned: shares.unassigned,
    discountExceeds: receiptDiscountExceeds(readable),
  };
});

const discountError = computed(() => {
  if (receipt.value?.discount === null) return t('receipt.discountUnreadable');
  return receipt.value?.discountExceeds ? t('receipt.receiptDiscountExceeds') : undefined;
});

const payerName = computed(
  () => trip.value.participants.find(({ id }) => id === state.mainPayerId)?.name ?? '?',
);

// The texts that change when the money was received rather than paid.
const texts = computed(() => {
  if (state.received) {
    return {
      heading: expense ? t('expense.editIncome') : t('expense.newIncome'),
      save: t('expense.saveIncome'),
    };
  }
  return { heading: expense ? t('expense.edit') : t('expense.new'), save: t('expense.save') };
});

function validate(form: Partial<ExpenseFormState>): FormError[] {
  const errors: FormError[] = [];
  if (!expenseTitleSchema.safeParse(form.title).success) {
    errors.push({ name: 'title', message: t('expense.titleInvalid') });
  }
  if (receipt.value) {
    if (receipt.value.items.length === 0) {
      errors.push({ name: 'lineItems', message: t('receipt.lineItemsMissing') });
    } else if (receipt.value.items.includes(null)) {
      errors.push({ name: 'lineItems', message: t('receipt.lineItemsUnreadable') });
    }
    if (receipt.value.discount === null) {
      errors.push({ name: 'discount', message: t('receipt.discountUnreadable') });
    }
  } else {
    if (parseMoney(form.amount ?? '', trip.value.currency) === null) {
      const decimals = minorUnits(trip.value.currency);
      errors.push({ name: 'amount', message: t('expense.amountInvalid', { decimals }, decimals) });
    }
    if (!form.participantIds?.length) {
      errors.push({ name: 'participantIds', message: t('expense.participantsMissing') });
    }
  }
  if (!form.mainPayerId) {
    const message = form.received ? t('expense.receiverMissing') : t('expense.payerMissing');
    errors.push({ name: 'mainPayerId', message });
  }
  if (!form.local) errors.push({ name: 'local', message: t('expense.timeMissing') });
  return errors;
}

// The Line items to save: the Receipt's, or the plain Expense's one.
function lineItems(): LineItem[] {
  if (receipt.value) return receipt.value.items.flatMap((item) => (item ? [item] : []));
  return [
    {
      name: '',
      unitPrice: (state.received ? -1 : 1) * parseMoney(state.amount, trip.value.currency)!,
      quantity: 1,
      split: { mode: 'even', participantIds: tickedInTripOrder() },
    },
  ];
}

// Which Trip rules the last save broke; the Expense itself stays as it was.
const refusals = ref<string[]>([]);
const saving = ref(false);

async function submit(): Promise<void> {
  saving.value = true;
  const refused = await saveExpense(
    {
      id,
      title: state.title.trim(),
      // An Expense carries its own currency; for now it is always the Trip currency.
      currency: trip.value.currency,
      time: expenseTimeFromLocal(state.local, state.zone),
      mainPayerId: state.mainPayerId,
      lineItems: lineItems(),
      // Left out when there is none, as the device store and the server keep it.
      ...(receipt.value?.discount && { discount: receipt.value.discount }),
    },
    // Based on the Expense as the form read it when it opened.
    expense?.base ?? { version: null },
  ).finally(() => (saving.value = false));

  refusals.value = refused.map((problem) => t(`expense.refused.${problem}`));
  if (refused.length === 0) await back(parent);
}
</script>

<template>
  <NuxtLayout name="form" :title="texts.heading" :parent="parent" :close="!expense">
    <UForm id="expense-form" :state="state" :validate="validate" class="space-y-5" @submit="submit">
      <div v-if="receipt" class="text-center">
        <p id="receipt-total-label" class="text-sm text-muted">{{ $t('receipt.total') }}</p>
        <output aria-labelledby="receipt-total-label" class="block text-4xl font-bold tabular-nums">
          {{ formatMoney(receipt.total, trip.currency, locale) }}
        </output>
        <p v-if="receipt.discount" class="mt-1 text-sm text-muted">
          {{
            $t('receipt.receiptDiscountFact', {
              discount: formatDiscount(receipt.discount, receipt.off, trip.currency, locale),
            })
          }}
        </p>
        <p v-if="receipt.unassigned.numerator !== 0n" class="mt-1 text-sm text-warning">
          {{
            $t('receipt.unassignedTotal', {
              amount: formatMoney(receipt.unassigned, trip.currency, locale),
              name: payerName,
            })
          }}
        </p>
      </div>

      <template v-else>
        <UFormField name="amount" :label="$t('expense.amount')" :ui="{ label: 'sr-only' }">
          <AmountInput v-model="state.amount" :currency="trip.currency" />
        </UFormField>

        <USwitch
          v-model="state.received"
          :label="$t('expense.moneyReceived')"
          :description="$t('expense.moneyReceivedHelp')"
        />
      </template>

      <UFormField name="title" :label="$t('expense.title')">
        <UInput
          v-model="state.title"
          :placeholder="$t('expense.titlePlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField v-if="state.lineItems" name="lineItems">
        <TillList
          v-model="state.lineItems"
          :participants="trip.participants"
          :currency="trip.currency"
        />
      </UFormField>

      <UFormField name="mainPayerId">
        <ParticipantPicker
          v-model="state.mainPayerId"
          :participants="trip.participants"
          :label="state.received ? $t('expense.receivedBy') : $t('expense.paidBy')"
          name="mainPayerId"
        />
      </UFormField>

      <DiscountField
        v-if="state.lineItems"
        v-model="state.discount"
        :label="$t('receipt.receiptDiscount')"
        :currency="trip.currency"
        :error="discountError"
      />

      <UFormField v-if="!state.lineItems" name="participantIds">
        <div role="group" aria-labelledby="for-whom-label">
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <p id="for-whom-label" class="text-sm font-medium">{{ $t('expense.forWhom') }}</p>
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
              v-for="participant in trip.participants"
              :key="participant.id"
              :participant="participant"
              type="checkbox"
              name="participantIds"
              :checked="state.participantIds.includes(participant.id)"
              @update:checked="tick(participant.id, $event)"
            />
          </div>
        </div>
      </UFormField>

      <ExpenseTimeField v-model:local="state.local" v-model:zone="state.zone" />

      <UButton
        v-if="!state.lineItems && !state.received"
        icon="i-lucide-plus"
        :label="$t('receipt.itemise')"
        variant="soft"
        block
        @click="itemise"
      />
    </UForm>

    <template #action>
      <UAlert
        v-if="refusals.length > 0"
        color="error"
        icon="i-lucide-circle-alert"
        :title="$t('expense.refused.title')"
        :description="refusals.join(' ')"
        class="mb-3"
      />
      <UButton
        type="submit"
        form="expense-form"
        block
        size="xl"
        :loading="saving"
        :label="texts.save"
      />
    </template>
  </NuxtLayout>
</template>
