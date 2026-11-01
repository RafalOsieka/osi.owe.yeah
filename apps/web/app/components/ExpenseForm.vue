<script setup lang="ts">
import {
  deviceTimeZone,
  expenseTimeFromLocal,
  expenseTitleSchema,
  fromMinor,
  localDateTime,
  minorUnits,
  parseMoney,
  roundMoney,
  type SplitExpense,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import type { RouteLocationRaw } from 'vue-router';
import { v7 as uuidv7 } from 'uuid';
import type { LocalExpense } from '~/sync/local-trip';

// The full-screen Expense form, for a new plain Expense or Income or to edit one: amount,
// whether it is money received (Income, saved with a negative amount so nobody types a minus),
// title, Main payer (who received it, for Income), who it is for, and when. Saving keeps the
// Expense's full new state on the device, to sync later, and returns to `parent`'s screen, or
// wherever the form was opened from. An Expense that breaks a Trip rule is not saved; why
// shows above Save.
const { expense = null, parent } = defineProps<{
  expense?: Extract<LocalExpense, SplitExpense> | null;
  /** The screen above the form, for back when it was opened from a link. */
  parent: RouteLocationRaw;
}>();

const { trip, claim, saveExpense } = useOpenTrip();
const { t } = useI18n();
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
};

// Read once: the form is mounted afresh each time it opens.
function initialState(): ExpenseFormState {
  const { participants } = trip.value;
  if (expense) {
    const [lineItem] = expense.lineItems;
    const price = lineItem!.unitPrice;
    return {
      title: expense.title,
      amount: roundMoney(fromMinor(Math.abs(price), expense.currency), expense.currency).decimal,
      received: price < 0,
      mainPayerId: expense.mainPayerId,
      participantIds: [...lineItem!.split.participantIds],
      local: localDateTime(expense.time),
      zone: expense.time.zone,
    };
  }
  const zone = deviceTimeZone();
  const claimed = participants.find(({ id }) => id === claim.value?.id);
  return {
    title: '',
    amount: '',
    received: false,
    mainPayerId: claimed?.id ?? participants[0]?.id ?? '',
    participantIds: participants.map(({ id }) => id),
    local: localDateTime({ instant: new Date().toISOString(), zone }),
    zone,
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
  if (parseMoney(form.amount ?? '', trip.value.currency) === null) {
    const decimals = minorUnits(trip.value.currency);
    errors.push({ name: 'amount', message: t('expense.amountInvalid', { decimals }, decimals) });
  }
  if (!form.mainPayerId) {
    const message = form.received ? t('expense.receiverMissing') : t('expense.payerMissing');
    errors.push({ name: 'mainPayerId', message });
  }
  if (!form.participantIds?.length) {
    errors.push({ name: 'participantIds', message: t('expense.participantsMissing') });
  }
  if (!form.local) errors.push({ name: 'local', message: t('expense.timeMissing') });
  return errors;
}

// Which Trip rules the last save broke; the Expense itself stays as it was.
const refusals = ref<string[]>([]);
const saving = ref(false);

async function submit(): Promise<void> {
  const ticked = new Set(state.participantIds);
  saving.value = true;
  const refused = await saveExpense(
    {
      id,
      title: state.title.trim(),
      // An Expense carries its own currency; for now it is always the Trip currency.
      currency: trip.value.currency,
      time: expenseTimeFromLocal(state.local, state.zone),
      mainPayerId: state.mainPayerId,
      lineItems: [
        {
          unitPrice: (state.received ? -1 : 1) * parseMoney(state.amount, trip.value.currency)!,
          split: {
            mode: 'even',
            // Kept in the Trip's order, whatever order they were ticked in.
            participantIds: trip.value.participants
              .map(({ id: participantId }) => participantId)
              .filter((participantId) => ticked.has(participantId)),
          },
        },
      ],
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
      <UFormField name="amount" :label="$t('expense.amount')" :ui="{ label: 'sr-only' }">
        <AmountInput v-model="state.amount" :currency="trip.currency" />
      </UFormField>

      <USwitch
        v-model="state.received"
        :label="$t('expense.moneyReceived')"
        :description="$t('expense.moneyReceivedHelp')"
      />

      <UFormField name="title" :label="$t('expense.title')">
        <UInput
          v-model="state.title"
          :placeholder="$t('expense.titlePlaceholder')"
          class="w-full"
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

      <UFormField name="participantIds">
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
