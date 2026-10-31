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
  type Expense,
  type StoredExpense,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import { v7 as uuidv7 } from 'uuid';

// Records a new plain Expense or edits one: title, amount, Main payer, who it is for, and
// when. Emits the Expense's full new state; the parent sends it and reports refusals.
const {
  trip,
  expense = null,
  claimId = null,
} = defineProps<{
  trip: TripWithParticipants;
  expense?: StoredExpense | null;
  /** The Claim's Participant id: the Main payer of a new Expense. */
  claimId?: string | null;
}>();
const emit = defineEmits<{ submit: [expense: Expense] }>();

const { t } = useI18n();

type ExpenseFormState = {
  title: string;
  amount: string;
  mainPayerId: string;
  participantIds: string[];
  /** Local date and time (`YYYY-MM-DDTHH:mm`) in `zone`. */
  local: string;
  zone: string;
};

// Read once: the form is mounted afresh each time it opens.
function initialState(): ExpenseFormState {
  if (expense) {
    const [lineItem] = expense.lineItems;
    return {
      title: expense.title,
      amount: roundMoney(fromMinor(lineItem!.unitPrice, expense.currency), expense.currency)
        .decimal,
      mainPayerId: expense.mainPayerId,
      participantIds: [...lineItem!.split.participantIds],
      local: localDateTime(expense.time),
      zone: expense.time.zone,
    };
  }
  const zone = deviceTimeZone();
  const claimed = trip.participants.some(({ id }) => id === claimId) ? claimId : null;
  return {
    title: '',
    amount: '',
    mainPayerId: claimed ?? trip.participants[0]?.id ?? '',
    participantIds: trip.participants.map(({ id }) => id),
    local: localDateTime({ instant: new Date().toISOString(), zone }),
    zone,
  };
}

const state = reactive(initialState());
// A new Expense keeps its id across retries, so a resend is recognised as the same Expense.
const id = expense?.id ?? uuidv7();

const participants = computed(() =>
  trip.participants.map(({ id: value, name: label }) => ({ value, label })),
);
// The device's zone may be an alias missing from the list, so it is always offered.
const zones = computed(() => [...new Set([state.zone, ...Intl.supportedValuesOf('timeZone')])]);

function validate(form: Partial<ExpenseFormState>): FormError[] {
  const errors: FormError[] = [];
  if (!expenseTitleSchema.safeParse(form.title).success) {
    errors.push({ name: 'title', message: t('expense.titleInvalid') });
  }
  if (parseMoney(form.amount ?? '', trip.currency) === null) {
    const decimals = minorUnits(trip.currency);
    errors.push({ name: 'amount', message: t('expense.amountInvalid', { decimals }, decimals) });
  }
  if (!form.mainPayerId) errors.push({ name: 'mainPayerId', message: t('expense.payerMissing') });
  if (!form.participantIds?.length) {
    errors.push({ name: 'participantIds', message: t('expense.participantsMissing') });
  }
  if (!form.local) errors.push({ name: 'local', message: t('expense.timeMissing') });
  return errors;
}

function submit(): void {
  const ticked = new Set(state.participantIds);
  emit('submit', {
    id,
    title: state.title.trim(),
    // An Expense carries its own currency; for now it is always the Trip currency.
    currency: trip.currency,
    time: expenseTimeFromLocal(state.local, state.zone),
    mainPayerId: state.mainPayerId,
    lineItems: [
      {
        unitPrice: parseMoney(state.amount, trip.currency)!,
        split: {
          mode: 'even',
          // Kept in the Trip's order, whatever order they were ticked in.
          participantIds: trip.participants
            .map(({ id: participantId }) => participantId)
            .filter((participantId) => ticked.has(participantId)),
        },
      },
    ],
  });
}
</script>

<template>
  <UForm :state="state" :validate="validate" class="space-y-4" @submit="submit">
    <UFormField name="title" :label="$t('expense.title')">
      <UInput v-model="state.title" :placeholder="$t('expense.titlePlaceholder')" class="w-full" />
    </UFormField>
    <UFormField name="amount" :label="$t('expense.amount')">
      <UInput v-model="state.amount" inputmode="decimal" class="w-full">
        <template #trailing>
          <span class="text-sm text-muted">{{ trip.currency }}</span>
        </template>
      </UInput>
    </UFormField>
    <UFormField name="mainPayerId" :label="$t('expense.paidBy')">
      <USelect v-model="state.mainPayerId" :items="participants" class="w-full" />
    </UFormField>
    <UFormField name="participantIds">
      <UCheckboxGroup
        v-model="state.participantIds"
        :items="participants"
        :legend="$t('expense.forWhom')"
      />
    </UFormField>
    <UFormField name="local" :label="$t('expense.when')">
      <UInput v-model="state.local" type="datetime-local" class="w-full" />
      <template #help>
        <USelectMenu
          v-model="state.zone"
          :items="zones"
          :aria-label="$t('expense.timeZone')"
          variant="ghost"
          size="xs"
          icon="i-lucide-globe"
        />
      </template>
    </UFormField>
    <slot />
    <UButton type="submit" :label="$t('expense.save')" />
  </UForm>
</template>
