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
  type Repayment,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import type { RouteLocationRaw } from 'vue-router';
import { v7 as uuidv7 } from 'uuid';
import type { LocalExpense } from '~/sync/local-trip';

// The full-screen Repayment form, for a new Repayment or to edit one: amount, who paid, who
// got the money, a title and when. A new one may start from a Suggested Repayment
// (`suggested`), its amount still editable for a partial Repayment; otherwise who paid
// defaults to the Claim. Saving works like the Expense form's.
const {
  repayment = null,
  suggested = null,
  parent,
} = defineProps<{
  repayment?: Extract<LocalExpense, Repayment> | null;
  /** What a new Repayment starts with; any part may be missing. */
  suggested?: { payerId?: string; recipientId?: string; amount?: string } | null;
  /** The screen above the form, for back when it was opened from a link. */
  parent: RouteLocationRaw;
}>();

const { trip, claim, saveExpense } = useOpenTrip();
const { t } = useI18n();
const back = useBack();

type RepaymentFormState = {
  title: string;
  amount: string;
  mainPayerId: string;
  recipientId: string;
  /** Local date and time (`YYYY-MM-DDTHH:mm`) in `zone`. */
  local: string;
  zone: string;
};

// Read once: the form is mounted afresh each time it opens.
function initialState(): RepaymentFormState {
  if (repayment) {
    return {
      title: repayment.title,
      amount: roundMoney(fromMinor(repayment.amount, repayment.currency), repayment.currency)
        .decimal,
      mainPayerId: repayment.mainPayerId,
      recipientId: repayment.recipientId,
      local: localDateTime(repayment.time),
      zone: repayment.time.zone,
    };
  }
  const known = (id: string | undefined) =>
    trip.value.participants.find((participant) => participant.id === id)?.id;
  const zone = deviceTimeZone();
  return {
    title: t('repayment.title'),
    amount: suggested?.amount ?? '',
    mainPayerId: known(suggested?.payerId) ?? known(claim.value?.id) ?? '',
    recipientId: known(suggested?.recipientId) ?? '',
    local: localDateTime({ instant: new Date().toISOString(), zone }),
    zone,
  };
}

const state = reactive(initialState());
const id = repayment?.id ?? uuidv7();

function validate(form: Partial<RepaymentFormState>): FormError[] {
  const errors: FormError[] = [];
  if (parseMoney(form.amount ?? '', trip.value.currency) === null) {
    const decimals = minorUnits(trip.value.currency);
    errors.push({ name: 'amount', message: t('expense.amountInvalid', { decimals }, decimals) });
  }
  if (!form.mainPayerId) errors.push({ name: 'mainPayerId', message: t('expense.payerMissing') });
  if (!form.recipientId) {
    errors.push({ name: 'recipientId', message: t('repayment.recipientMissing') });
  } else if (form.recipientId === form.mainPayerId) {
    errors.push({ name: 'recipientId', message: t('repayment.sameParticipant') });
  }
  if (!expenseTitleSchema.safeParse(form.title).success) {
    errors.push({ name: 'title', message: t('expense.titleInvalid') });
  }
  if (!form.local) errors.push({ name: 'local', message: t('expense.timeMissing') });
  return errors;
}

// Which Trip rules the last save broke; the Repayment itself stays as it was.
const refusals = ref<string[]>([]);
const saving = ref(false);

async function submit(): Promise<void> {
  saving.value = true;
  const refused = await saveExpense(
    {
      id,
      title: state.title.trim(),
      // A Repayment carries its own currency; for now it is always the Trip currency.
      currency: trip.value.currency,
      time: expenseTimeFromLocal(state.local, state.zone),
      mainPayerId: state.mainPayerId,
      recipientId: state.recipientId,
      amount: parseMoney(state.amount, trip.value.currency)!,
    },
    // Based on the Repayment as the form read it when it opened.
    repayment?.base ?? { version: null },
  ).finally(() => (saving.value = false));

  refusals.value = refused.map((problem) => t(`expense.refused.${problem}`));
  if (refused.length === 0) await back(parent);
}
</script>

<template>
  <NuxtLayout
    name="form"
    :title="repayment ? $t('repayment.edit') : $t('repayment.new')"
    :parent="parent"
    :close="!repayment"
  >
    <UForm
      id="repayment-form"
      :state="state"
      :validate="validate"
      class="space-y-5"
      @submit="submit"
    >
      <UFormField name="amount" :label="$t('expense.amount')" :ui="{ label: 'sr-only' }">
        <AmountInput v-model="state.amount" :currency="trip.currency" />
      </UFormField>

      <UFormField name="mainPayerId">
        <ParticipantPicker
          v-model="state.mainPayerId"
          :participants="trip.participants"
          :label="$t('expense.paidBy')"
          name="mainPayerId"
        />
      </UFormField>

      <UFormField name="recipientId">
        <ParticipantPicker
          v-model="state.recipientId"
          :participants="trip.participants"
          :label="$t('repayment.paidTo')"
          name="recipientId"
        />
      </UFormField>

      <UFormField name="title" :label="$t('expense.title')">
        <UInput v-model="state.title" class="w-full" />
      </UFormField>

      <ExpenseTimeField v-model:local="state.local" v-model:zone="state.zone" />
    </UForm>

    <template #action>
      <UAlert
        v-if="refusals.length > 0"
        color="error"
        icon="i-lucide-circle-alert"
        :title="$t('repayment.refused')"
        :description="refusals.join(' ')"
        class="mb-3"
      />
      <UButton
        type="submit"
        form="repayment-form"
        block
        size="xl"
        :loading="saving"
        :label="$t('repayment.save')"
      />
    </template>
  </NuxtLayout>
</template>
