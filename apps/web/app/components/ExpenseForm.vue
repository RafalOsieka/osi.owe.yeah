<script setup lang="ts">
import { deviceTimeZone, type SplitExpense } from '@osi/owe-yeah-domain';
import type { RouteLocationRaw } from 'vue-router';
import type { LocalExpense } from '~/sync/local-trip';
import {
  draftFromExpense,
  itemise,
  newExpenseDraft,
  pickMainPayer,
  readDraft,
  type SplitDraft,
} from '~/utils/expense-draft';

// The full-screen Expense form, for a new plain Expense or Income or to edit one: amount,
// title, Main payer (who received it, for Income), who it is for, and when, then the rarer
// options in a card at the end: whether it is money received (Income, saved with a negative
// amount so nobody types a minus) and "Itemise as a Receipt", which grows the one Line item
// into the Till list on the same page: the amount becomes the computed Receipt total, each
// Line item has its own split, Line discount and Deposit, Deposit refunds come off it, and a
// Receipt discount right under the lines comes off the goods. The Deposits total shows under the Receipt total, to check against the Deposits printed on the
// paper Receipt, and the total may go negative. A Receipt may be saved with value not
// assigned yet, which counts as the Main payer's until it is. Under "Paid by", any Expense
// but Income takes Contributions from others (so the Income switch hides while there are
// any); the Main payer covers the rest, so a price edit changes only their part, and someone
// with a Contribution can't be picked as Main payer. The Expense has its own currency, any in
// circulation, picked from the pill under the amount: a new one starts in the currency of the
// Expense saved last on this device, or else the Trip currency. Every amount is entered in it,
// and the pill says what the total comes to in the Trip currency, at a Manual rate if one is
// typed next to it (`ExpenseCurrency`). What is typed is read as an Expense draft
// (`readDraft`): a Trip rule the Expense would break shows at its field while the form is
// filled in. Saving keeps the Expense's full new state on the device, to sync later, and
// returns to `parent`'s screen, or wherever the form was opened from. A refusal the form
// couldn't foresee shows above Save.
const { expense = null, parent } = defineProps<{
  expense?: Extract<LocalExpense, SplitExpense> | null;
  /** The screen above the form, for back when it was opened from a link. */
  parent: RouteLocationRaw;
}>();

const { trip, claim, lastCurrency, saveExpense } = useOpenTrip();
const { t, locale } = useI18n();
const back = useBack();
const { draftReason, formErrors, problemAt } = useDraftReasons();

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

// The amount typed so far becomes the Receipt's first Line item.
function itemiseReceipt(): void {
  Object.assign(state, itemise(state, trip.value));
}

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
    <UForm
      id="expense-form"
      :state="state"
      :validate="() => formErrors(reading.reasons, state)"
      class="space-y-5"
      @submit="submit"
    >
      <div v-if="reading.receipt" class="card px-4 py-5 text-center">
        <p id="receipt-total-label" class="text-sm text-muted">{{ $t('receipt.total') }}</p>
        <output
          aria-labelledby="receipt-total-label"
          class="mt-1 block text-5xl font-semibold tracking-tight text-highlighted tabular-nums"
        >
          {{ formatMoney(reading.receipt.total, state.currency, locale) }}
        </output>
        <ExpenseCurrency
          v-model:currency="state.currency"
          v-model:manual-rate="state.manualRate"
          :reading="reading"
          :error="problemAt(reading.reasons, 'manualRate')"
          class="mt-2 text-start"
        />
        <p v-if="reading.receipt.discount" class="mt-1 text-sm text-muted">
          {{
            $t('receipt.receiptDiscountFact', {
              discount: formatDiscount(
                reading.receipt.discount,
                reading.receipt.discountOff,
                state.currency,
                locale,
              ),
            })
          }}
        </p>
        <p v-if="reading.receipt.deposits.numerator !== 0n" class="mt-1 text-sm text-muted">
          {{
            $t('receipt.depositsFact', {
              amount: formatMoney(reading.receipt.deposits, state.currency, locale),
            })
          }}
        </p>
        <p v-if="reading.receipt.unassigned.numerator !== 0n" class="mt-1 text-sm text-warning">
          {{
            $t('receipt.unassignedTotal', {
              amount: formatMoney(reading.receipt.unassigned, state.currency, locale),
              name: payerName,
            })
          }}
        </p>
      </div>

      <div v-else class="card px-4 pt-3 pb-3.5">
        <UFormField
          name="amount"
          :label="$t('expense.amount')"
          :ui="{ labelWrapper: 'justify-center', label: 'text-sm font-medium text-muted' }"
        >
          <AmountInput v-model="state.amount" :currency="state.currency" />
        </UFormField>
        <ExpenseCurrency
          v-model:currency="state.currency"
          v-model:manual-rate="state.manualRate"
          :reading="reading"
          :error="problemAt(reading.reasons, 'manualRate')"
          class="mt-2"
        />
      </div>

      <div class="card space-y-5 p-4">
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
            :discounted="!!reading.receipt?.discount"
          />
        </UFormField>

        <DiscountField
          v-if="state.lineItems"
          v-model="state.discount"
          :label="$t('receipt.receiptDiscount')"
          :currency="state.currency"
          :error="discountError"
        />

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

        <UFormField
          v-if="!state.lineItems"
          name="participantIds"
          :error="problemAt(reading.reasons, 'participantIds')"
        >
          <div role="group" aria-labelledby="for-whom-label">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p id="for-whom-label" class="text-sm font-medium text-highlighted">
                {{ $t('expense.forWhom') }}
              </p>
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

      <div
        v-if="!reading.receipt && (state.contributions.length === 0 || !state.received)"
        class="card divide-y divide-default overflow-hidden"
      >
        <USwitch
          v-if="state.contributions.length === 0"
          v-model="state.received"
          :label="$t('expense.moneyReceived')"
          :description="$t('expense.moneyReceivedHelp')"
          class="px-4 py-3.5"
        />
        <button
          v-if="!state.lineItems && !state.received"
          type="button"
          class="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-start font-medium text-primary transition-colors hover:bg-elevated/60"
          @click="itemiseReceipt"
        >
          <UIcon name="i-lucide-list-plus" class="size-5 shrink-0" />
          {{ $t('receipt.itemise') }}
        </button>
      </div>
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
