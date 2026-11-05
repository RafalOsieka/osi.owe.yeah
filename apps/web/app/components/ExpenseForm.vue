<script setup lang="ts">
import {
  add,
  deviceTimeZone,
  lineItemShares,
  multiply,
  negate,
  rational,
  type Rational,
  type SplitExpense,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import type { RouteLocationRaw } from 'vue-router';
import type { LocalExpense } from '~/sync/local-trip';
import {
  draftFromExpense,
  itemise,
  newExpenseDraft,
  pickMainPayer,
  readDraft,
  readLineItem,
  type SplitDraft,
} from '~/utils/expense-draft';

// The full-screen Expense form, for a new plain Expense or Income or to edit one: amount with
// its currency beside it, title, Main payer (who received it, for Income) with any
// Contributions as one ledger of who pays what, who it is for (and what that comes to each),
// and when, then the rarer options in a card at the end: whether it is money received (Income,
// saved with a negative amount so nobody types a minus; off while there are Contributions, as
// Income has none) and "Itemise as a Receipt", which grows the one Line item into the Till list
// on the same page: the amount becomes the computed Receipt total, each Line item has its own
// split, Line discount and Deposit, and Deposit refunds come off it. The Till list closes with
// the Receipt's sums as the detail page shows them: Subtotal (the goods after their Line
// discounts), Deposit refunds, the Receipt discount (typed there, its one place), Deposits (to
// check against the paper Receipt) and the Receipt total. Under the total on top, what is not
// assigned yet, headed as on the detail page (in units where it can be, and whose it is for
// now: the Main payer's), then each line it is on, with a link to it. The total may go negative. A line typed
// into the Till list's add form but not added greys out Save, saying why, until it is added or
// discarded. Under "Paid by", any Expense but Income takes Contributions from others; the Main
// payer covers the rest, so a price edit changes only their part, and someone with a
// Contribution can't be picked as Main payer. The Expense has its own currency, any in
// circulation: a new one starts in the currency of the Expense saved last on this device, or
// else the Trip currency. Every amount is entered in it, and under the amount shows what the
// total comes to in the Trip currency, at a Manual rate if one is typed (`ExpenseCurrency`).
// What is typed is read as an Expense draft (`readDraft`): a Trip rule the Expense would break
// shows at its field while the form is filled in. Saving keeps the Expense's full new state on
// the device, to sync later, and returns to `parent`'s screen, or wherever the form was opened
// from. A refusal the form couldn't foresee shows above Save.
const { expense = null, parent } = defineProps<{
  expense?: Extract<LocalExpense, SplitExpense> | null;
  /** The screen above the form, for back when it was opened from a link. */
  parent: RouteLocationRaw;
}>();

const { trip, claim, lastCurrency, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const back = useBack();
const { draftReason, formErrors, problemAt } = useDraftReasons();
const discountText = useDiscountText();

// Read once: the form is mounted afresh each time it opens.
const state = reactive<SplitDraft>(
  expense
    ? draftFromExpense(expense, trip.value)
    : newExpenseDraft(trip.value, {
        now: new Date(),
        zone: deviceTimeZone(),
        claimId: claim.value?.id ?? null,
        lastCurrency: lastCurrency.value,
      }),
);

// What is typed, read live and when saving.
const reading = computed(() => readDraft(state, trip.value));

const money = (amount: Rational) => formatMoney(amount, state.currency, locale.value);

const allTicked = computed(() => state.participantIds.length === trip.value.participants.length);

function tick(participantId: string, ticked: boolean): void {
  state.participantIds = ticked
    ? [...state.participantIds, participantId]
    : state.participantIds.filter((other) => other !== participantId);
}

// "Select all" ticks everyone, or "Clear" unticks everyone when everyone is ticked already.
function toggleAll(): void {
  state.participantIds = allTicked.value ? [] : trip.value.participants.map(({ id }) => id);
}

// How the plain Expense is split: evenly, and what that comes to each once the amount reads.
const splitSummary = computed(() => {
  const count = state.participantIds.length;
  if (count < 2) return null;
  const { total } = reading.value;
  if (!total || total.numerator === 0n) return t('expense.splitBetween', { count });
  const each = multiply(total.numerator < 0n ? negate(total) : total, rational(1n, BigInt(count)));
  return t('expense.splitEach', { amount: money(each) });
});

const discountError = computed(() => {
  const reason = reading.value.reasons.find(({ field }) => field === 'discount');
  return reason && draftReason(reason, state);
});

// Who was refused as Main payer for having a Contribution; the reason shows while it stands.
const refusedPayerId = ref<string>();
const payerRefusal = computed(() => {
  const refused = trip.value.participants.find(({ id }) => id === refusedPayerId.value);
  if (!refused) return undefined;
  const contributes = state.contributions.some(({ participantId }) => participantId === refused.id);
  return contributes ? t('contribution.payerRefused', { name: refused.name }) : undefined;
});

function pickPayer(participantId: string): void {
  const picked = pickMainPayer(state, participantId);
  if (picked === 'contributes') {
    refusedPayerId.value = participantId;
    return;
  }
  refusedPayerId.value = undefined;
  Object.assign(state, picked);
}

// The Till list's open line, and whether its add form holds a line not on the Receipt yet.
const openLine = ref<string | null>(null);
const pendingLine = ref(false);

// The amount typed so far becomes the Receipt's first Line item.
function itemiseReceipt(): void {
  Object.assign(state, itemise(state, trip.value));
}

// The Receipt's readable lines, each with its shares, in order.
const lines = computed(() =>
  (state.lineItems ?? []).flatMap((line, index) => {
    const { lineItem } = readLineItem(line, state.currency);
    return lineItem
      ? [{ line, index, lineItem, shares: lineItemShares(lineItem, state.currency) }]
      : [];
  }),
);

// The goods after their Line discounts, and the Deposit refunds, as the Receipt's sums show
// them: refunds are their own row, not part of the Subtotal.
const sums = computed(() => {
  const zero = rational(0n);
  return lines.value.reduce(
    (sums, { line, shares }) =>
      line.refund
        ? { ...sums, refunds: add(sums.refunds, shares.net) }
        : { ...sums, subtotal: add(sums.subtotal, shares.net) },
    { subtotal: zero, refunds: zero },
  );
});

// The lines with value not assigned yet, by name and how many of their units, for the Receipt
// total to point at.
const unassignedLines = computed(() =>
  lines.value.flatMap(({ line, index, lineItem, shares }) => {
    if (shares.unassigned.numerator === 0n) return [];
    const name =
      line.name.trim() ||
      (line.refund ? t('receipt.depositRefund') : t('receipt.unnamed', { position: index + 1 }));
    const units =
      lineItem.split.mode === 'units'
        ? lineItem.quantity - lineItem.split.parts.reduce((sum, part) => sum + part.units, 0)
        : null;
    return [{ key: line.key, name, units }];
  }),
);

// What is not assigned yet in all, as the detail page heads it: in units while every line it
// is on has them ("1 unit unassigned"), the value otherwise, and whose it is for now; with the
// value after it in units.
const unassignedSummary = computed(() => {
  const unassigned = reading.value.receipt?.unassigned;
  if (!unassigned || unassigned.numerator === 0n) return null;
  const counts = unassignedLines.value.map(({ units }) => units);
  const units = counts.every((count) => count !== null)
    ? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
    : null;
  const payer = trip.value.participants.find(({ id }) => id === state.mainPayerId);
  const whose =
    payer && payer.id === claim.value?.id
      ? t('receipt.countedAsYours')
      : t('receipt.countedAs', { name: payer?.name ?? '?' });
  return {
    text: [
      units === null
        ? t('receipt.amountUnassigned', { amount: money(unassigned) })
        : t('receipt.unitsUnassignedTotal', units),
      whose,
    ].join(' · '),
    value: units === null ? null : money(unassigned),
  };
});

async function showLine(key: string): Promise<void> {
  openLine.value = key;
  await nextTick();
  document.getElementById(`line-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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

// The draft's reasons, and a line typed but not added, which would otherwise be lost on save
// (Save is greyed out then, but Enter in a field still submits).
function validate(): FormError[] {
  const errors = formErrors(reading.value.reasons, state);
  return pendingLine.value
    ? [...errors, { name: 'lineItems', message: t('receipt.pendingRefused') }]
    : errors;
}

// Which Trip rules the last save broke; the Expense itself stays as it was.
const refusals = ref<string[]>([]);
const saving = ref(false);

async function submit(): Promise<void> {
  // Complete by now: the form's validation passed.
  const { expense: read } = reading.value;
  if (!read) return;
  saving.value = true;
  // Based on the Expense as the form read it when it opened.
  const refused = await saveExpense(read, expense).finally(() => (saving.value = false));

  refusals.value = refused.map((problem) => t(`expense.refused.${problem}`));
  if (refused.length === 0) await back(parent);
}
</script>

<template>
  <NuxtLayout name="form" :title="texts.heading" :parent="parent" :close="!expense">
    <UForm id="expense-form" :state="state" :validate="validate" class="space-y-5" @submit="submit">
      <div v-if="reading.receipt" class="card px-4 pt-3 pb-4">
        <div class="flex items-end justify-between gap-3">
          <div class="min-w-0">
            <p id="receipt-total-label" class="text-sm font-medium text-muted">
              {{ $t('receipt.total') }}
            </p>
            <output
              aria-labelledby="receipt-total-label"
              class="block truncate text-[2.75rem] leading-tight font-semibold tracking-tight text-highlighted tabular-nums"
            >
              {{ money(reading.receipt.total) }}
            </output>
          </div>
          <CurrencyPill v-model="state.currency" class="mb-1.5" />
        </div>
        <ExpenseCurrency
          v-model:currency="state.currency"
          v-model:manual-rate="state.manualRate"
          :reading="reading"
          :error="problemAt(reading.reasons, 'manualRate')"
        />
        <div
          v-if="unassignedSummary"
          class="mt-3 flex gap-2.5 rounded-xl bg-warning/10 px-3 py-2.5 text-sm"
        >
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0 text-warning" />
          <div class="min-w-0 flex-1">
            <p class="font-medium text-highlighted">{{ unassignedSummary.text }}</p>
            <p v-if="unassignedSummary.value" class="text-muted tabular-nums">
              {{ unassignedSummary.value }}
            </p>
            <button
              v-for="line in unassignedLines"
              :key="line.key"
              type="button"
              class="-mb-1 flex min-h-10 w-full cursor-pointer items-center gap-1 text-start font-medium text-warning"
              @click="showLine(line.key)"
            >
              <span class="min-w-0 flex-1">{{ $t('receipt.openLine', { name: line.name }) }}</span>
              <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0" />
            </button>
          </div>
        </div>
      </div>

      <div v-else class="card relative px-4 pt-3 pb-4">
        <UFormField
          name="amount"
          :label="$t('expense.amount')"
          :ui="{ label: 'text-sm font-medium text-muted', error: 'mt-1.5' }"
        >
          <AmountInput v-model="state.amount" :currency="state.currency" />
        </UFormField>
        <!-- Over the amount's end, outside its field. -->
        <CurrencyPill
          v-model="state.currency"
          class="absolute end-6.5 top-[3.125rem] bg-default shadow-xs"
        />
        <ExpenseCurrency
          v-model:currency="state.currency"
          v-model:manual-rate="state.manualRate"
          :reading="reading"
          :error="problemAt(reading.reasons, 'manualRate')"
        />
      </div>

      <div v-if="state.lineItems" class="card p-4">
        <UFormField name="title" :label="$t('expense.title')">
          <UInput
            v-model="state.title"
            :placeholder="$t('expense.titlePlaceholder')"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField v-if="state.lineItems" name="lineItems">
        <TillList
          v-model="state.lineItems"
          v-model:open-key="openLine"
          v-model:pending="pendingLine"
          :participants="trip.participants"
          :currency="state.currency"
        >
          <!-- The Receipt's sums, as its detail page shows them. -->
          <div v-if="reading.receipt" class="space-y-3 tabular-nums">
            <dl class="flex justify-between gap-3 text-sm">
              <dt class="text-muted">{{ $t('receipt.subtotal') }}</dt>
              <dd>{{ money(sums.subtotal) }}</dd>
            </dl>
            <dl v-if="sums.refunds.numerator !== 0n" class="flex justify-between gap-3 text-sm">
              <dt class="text-muted">{{ $t('receipt.depositRefunds') }}</dt>
              <dd>{{ money(sums.refunds) }}</dd>
            </dl>
            <DiscountField
              v-model="state.discount"
              :label="$t('receipt.receiptDiscount')"
              :currency="state.currency"
              :error="discountError"
              :help="
                reading.receipt.discount?.kind === 'percent'
                  ? discountText(
                      reading.receipt.discount,
                      reading.receipt.discountOff,
                      state.currency,
                    )
                  : undefined
              "
            />
            <dl
              v-if="reading.receipt.deposits.numerator !== 0n"
              class="flex justify-between gap-3 text-sm"
            >
              <dt class="text-muted">{{ $t('receipt.deposits') }}</dt>
              <dd>{{ money(reading.receipt.deposits) }}</dd>
            </dl>
            <dl
              class="flex justify-between gap-3 border-t border-default pt-3 font-semibold text-highlighted"
            >
              <dt>{{ $t('receipt.total') }}</dt>
              <dd>{{ money(reading.receipt.total) }}</dd>
            </dl>
          </div>
        </TillList>
      </UFormField>

      <div class="card space-y-6 p-4">
        <UFormField v-if="!state.lineItems" name="title" :label="$t('expense.title')">
          <UInput
            v-model="state.title"
            :placeholder="$t('expense.titlePlaceholder')"
            class="w-full"
          />
        </UFormField>

        <div class="space-y-3">
          <UFormField
            name="mainPayerId"
            :error="payerRefusal ?? problemAt(reading.reasons, 'mainPayerId')"
          >
            <ParticipantPicker
              :model-value="state.mainPayerId"
              :participants="trip.participants"
              :label="state.received ? $t('expense.receivedBy') : $t('expense.paidBy')"
              name="mainPayerId"
              @update:model-value="pickPayer"
            />
          </UFormField>

          <UFormField
            v-if="!state.received"
            name="contributions"
            :error="problemAt(reading.reasons, 'contributions')"
          >
            <ContributionList
              v-model="state.contributions"
              :participants="trip.participants"
              :main-payer-id="state.mainPayerId"
              :currency="state.currency"
              :rest="reading.mainPayerPart"
            />
          </UFormField>
        </div>

        <UFormField
          v-if="!state.lineItems"
          name="participantIds"
          :error="problemAt(reading.reasons, 'participantIds')"
          :help="splitSummary ?? undefined"
        >
          <div role="group" aria-labelledby="for-whom-label">
            <div class="-mt-3 mb-1 flex items-center justify-between gap-2">
              <p id="for-whom-label" class="text-sm font-medium text-highlighted">
                {{ $t('expense.forWhom') }}
              </p>
              <UButton
                variant="link"
                :label="allTicked ? $t('expense.clearAll') : $t('expense.selectAll')"
                class="-me-4"
                @click="toggleAll"
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
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
      </div>

      <div v-if="!reading.receipt" class="card divide-y divide-default overflow-hidden">
        <USwitch
          v-model="state.received"
          :disabled="state.contributions.length > 0"
          :label="$t('expense.moneyReceived')"
          :description="
            state.contributions.length > 0
              ? $t('expense.moneyReceivedWithContributions')
              : $t('expense.moneyReceivedHelp')
          "
          class="px-4 py-3.5"
        />
        <button
          v-if="!state.lineItems && !state.received"
          type="button"
          class="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-start font-medium text-primary transition-colors hover:bg-elevated/60"
          @click="itemiseReceipt"
        >
          <UIcon name="i-lucide-list-plus" class="size-5 shrink-0" />
          {{ $t('receipt.itemise') }}
        </button>
      </div>
    </UForm>

    <template #action>
      <p
        v-if="pendingLine"
        role="status"
        class="mb-3 flex gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-highlighted"
      >
        <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0 text-warning" />
        {{ $t('receipt.pendingRefused') }}
      </p>
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
        :disabled="pendingLine"
        :color="pendingLine ? 'neutral' : 'primary'"
        :variant="pendingLine ? 'soft' : 'solid'"
        :loading="saving"
        :label="texts.save"
      />
    </template>
  </NuxtLayout>
</template>
