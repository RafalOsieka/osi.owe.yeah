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
  type Currency,
  type LineItem,
  type SplitExpense,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import type { RouteLocationRaw } from 'vue-router';
import { v7 as uuidv7 } from 'uuid';
import type { LocalExpense } from '~/sync/local-trip';
import {
  contributionsFromDraft,
  draftFromContributions,
  type DraftContribution,
} from '~/utils/contribution-draft';
import {
  draftFromManualRate,
  manualRateToSave,
  type DraftManualRate,
} from '~/utils/manual-rate-draft';
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
// computed Receipt total, each Line item has its own split, Line discount and Deposit, Deposit
// refunds come off it, and a Receipt discount below "Paid by" comes off the goods. The
// Deposits total shows under the Receipt total, to check against the Deposits printed on the
// paper Receipt, and the total may go negative. A Receipt may be saved with value not
// assigned yet, which counts as the Main payer's until it is. Under "Paid by", any Expense
// but Income takes Contributions from others (so the Income switch hides while there are
// any); the Main payer covers the rest, so a price edit changes only their part, and someone
// with a Contribution can't be picked as Main payer. The Expense has its own currency, any in
// circulation, picked from the pill under the amount: a new one starts in the currency of the
// Expense saved last on this device, or else the Trip currency. Every amount is entered in it,
// and the pill says what the total comes to in the Trip currency, at a Manual rate if one is
// typed next to it (`ExpenseCurrency`). Saving keeps the Expense's full new state on the
// device, to sync later, and returns to `parent`'s screen, or wherever the form was opened
// from. An Expense that breaks a Trip rule is not saved; why shows above Save.
const { expense = null, parent } = defineProps<{
  expense?: Extract<LocalExpense, SplitExpense> | null;
  /** The screen above the form, for back when it was opened from a link. */
  parent: RouteLocationRaw;
}>();

const { trip, claim, lastCurrency, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const back = useBack();
const manualRateErrors = useManualRateErrors();

type ExpenseFormState = {
  title: string;
  /** The currency every amount is entered in. */
  currency: Currency;
  /** The Manual rate, as typed; empty for none. */
  manualRate: DraftManualRate;
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
  /** Contributions from Participants other than the Main payer, in the order added. */
  contributions: DraftContribution[];
};

// Read once: the form is mounted afresh each time it opens.
function initialState(): ExpenseFormState {
  const { participants } = trip.value;
  const everyone = participants.map(({ id }) => id);
  if (expense) {
    const [lineItem] = expense.lineItems;
    const price = lineItem!.unitPrice;
    const time = { local: localDateTime(expense.time), zone: expense.time.zone };
    const shared = {
      title: expense.title,
      currency: expense.currency,
      manualRate: draftFromManualRate(expense.manualRate, trip.value.currency),
      mainPayerId: expense.mainPayerId,
      contributions: draftFromContributions(expense.contributions, expense.currency),
      ...time,
    };
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
    currency: lastCurrency.value ?? trip.value.currency,
    manualRate: draftFromManualRate(undefined, trip.value.currency),
    amount: '',
    received: false,
    mainPayerId: claimed?.id ?? participants[0]?.id ?? '',
    participantIds: everyone,
    local: localDateTime({ instant: new Date().toISOString(), zone }),
    zone,
    lineItems: null,
    discount: noDiscount(),
    contributions: [],
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
    parseMoney(state.amount, state.currency) === null
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
// computed total, what the discount takes off, the Deposits, and the value not assigned to
// anyone yet.
const receipt = computed(() => {
  if (!state.lineItems) return null;
  const { currency } = state;
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
    deposits: shares.deposits,
    unassigned: shares.unassigned,
    discountExceeds: receiptDiscountExceeds(readable),
  };
});

const discountError = computed(() => {
  if (receipt.value?.discount === null) return t('receipt.discountUnreadable');
  return receipt.value?.discountExceeds ? t('receipt.receiptDiscountExceeds') : undefined;
});

// Who was refused as Main payer for having a Contribution; the reason shows while it stands.
const refusedPayerId = ref<string>();
const payerRefusal = computed(() => {
  const refused = trip.value.participants.find(({ id }) => id === refusedPayerId.value);
  if (!refused) return undefined;
  const contributes = state.contributions.some(({ participantId }) => participantId === refused.id);
  return contributes ? t('contribution.payerRefused', { name: refused.name }) : undefined;
});

function pickMainPayer(participantId: string): void {
  if (state.contributions.some((contribution) => contribution.participantId === participantId)) {
    refusedPayerId.value = participantId;
    return;
  }
  refusedPayerId.value = undefined;
  state.mainPayerId = participantId;
}

// What the Expense comes to so far, which the Contributions come off; `null` while unreadable.
const total = computed(() => {
  if (receipt.value) return receipt.value.total;
  const { currency } = state;
  const amount = parseMoney(state.amount, currency);
  return amount === null ? null : fromMinor(state.received ? -amount : amount, currency);
});

// When the Expense happened, as typed so far; `null` while it is not set.
const time = computed(() => (state.local ? expenseTimeFromLocal(state.local, state.zone) : null));

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
    if (parseMoney(form.amount ?? '', state.currency) === null) {
      const decimals = minorUnits(state.currency);
      errors.push({ name: 'amount', message: t('expense.amountInvalid', { decimals }, decimals) });
    }
    if (!form.participantIds?.length) {
      errors.push({ name: 'participantIds', message: t('expense.participantsMissing') });
    }
  }
  errors.push(...manualRateErrors(state.manualRate, state.currency, total.value));
  if (contributionsFromDraft(state.contributions, state.currency) === null) {
    errors.push({ name: 'contributions', message: t('contribution.unreadable') });
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
      unitPrice: (state.received ? -1 : 1) * parseMoney(state.amount, state.currency)!,
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
  // Readable by now: `validate` passed.
  const contributions = contributionsFromDraft(state.contributions, state.currency)!;
  const manualRate = manualRateToSave(state.manualRate, state.currency);
  const refused = await saveExpense(
    {
      id,
      title: state.title.trim(),
      currency: state.currency,
      time: expenseTimeFromLocal(state.local, state.zone),
      mainPayerId: state.mainPayerId,
      lineItems: lineItems(),
      ...(manualRate && { manualRate }),
      // Left out when there is none, as the device store and the server keep it.
      ...(receipt.value?.discount && { discount: receipt.value.discount }),
      ...(contributions.length > 0 && { contributions }),
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
          {{ formatMoney(receipt.total, state.currency, locale) }}
        </output>
        <ExpenseCurrency
          v-model:currency="state.currency"
          v-model:manual-rate="state.manualRate"
          :total="total"
          :time="time"
          class="mt-2 text-start"
        />
        <p v-if="receipt.discount" class="mt-1 text-sm text-muted">
          {{
            $t('receipt.receiptDiscountFact', {
              discount: formatDiscount(receipt.discount, receipt.off, state.currency, locale),
            })
          }}
        </p>
        <p v-if="receipt.deposits.numerator !== 0n" class="mt-1 text-sm text-muted">
          {{
            $t('receipt.depositsFact', {
              amount: formatMoney(receipt.deposits, state.currency, locale),
            })
          }}
        </p>
        <p v-if="receipt.unassigned.numerator !== 0n" class="mt-1 text-sm text-warning">
          {{
            $t('receipt.unassignedTotal', {
              amount: formatMoney(receipt.unassigned, state.currency, locale),
              name: payerName,
            })
          }}
        </p>
      </div>

      <template v-else>
        <UFormField name="amount" :label="$t('expense.amount')" :ui="{ label: 'sr-only' }">
          <AmountInput v-model="state.amount" :currency="state.currency" />
        </UFormField>
        <ExpenseCurrency
          v-model:currency="state.currency"
          v-model:manual-rate="state.manualRate"
          :total="total"
          :time="time"
          class="-mt-3"
        />

        <USwitch
          v-if="state.contributions.length === 0"
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
          :currency="state.currency"
        />
      </UFormField>

      <UFormField name="mainPayerId" :error="payerRefusal">
        <ParticipantPicker
          :model-value="state.mainPayerId"
          :participants="trip.participants"
          :label="state.received ? $t('expense.receivedBy') : $t('expense.paidBy')"
          name="mainPayerId"
          @update:model-value="pickMainPayer"
        />
      </UFormField>

      <UFormField v-if="!state.received" name="contributions">
        <ContributionList
          v-model="state.contributions"
          :participants="trip.participants"
          :main-payer-id="state.mainPayerId"
          :currency="state.currency"
          :total="total"
        />
      </UFormField>

      <DiscountField
        v-if="state.lineItems"
        v-model="state.discount"
        :label="$t('receipt.receiptDiscount')"
        :currency="state.currency"
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
