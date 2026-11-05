<script setup lang="ts">
import { deviceTimeZone, type Repayment } from '@osi/owe-yeah-domain';
import type { RouteLocationRaw } from 'vue-router';
import type { LocalExpense } from '~/sync/local-trip';
import {
  draftFromExpense,
  newRepaymentDraft,
  readDraft,
  type RepaymentDraft,
} from '~/utils/expense-draft';

// The full-screen Repayment form, for a new Repayment or to edit one: amount, its currency
// with a Manual rate if needed (`ExpenseCurrency`), who paid, who got the money, a title and
// when. A new one is in the Trip currency until another is picked, and may start from a
// Suggested Repayment (`suggested`), its amount still editable for a partial Repayment;
// otherwise who paid defaults to the Claim. Reading and saving work like the Expense form's.
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
const { formErrors, problemAt } = useDraftReasons();

// Read once: the form is mounted afresh each time it opens.
const state = reactive<RepaymentDraft>(
  repayment
    ? draftFromExpense(repayment, trip.value)
    : newRepaymentDraft(trip.value, {
        now: new Date(),
        zone: deviceTimeZone(),
        claimId: claim.value?.id ?? null,
        title: t('repayment.title'),
        suggested,
      }),
);

// What is typed, read live and when saving.
const reading = computed(() => readDraft(state, trip.value));

// Which Trip rules the last save broke; the Repayment itself stays as it was.
const refusals = ref<string[]>([]);
const saving = ref(false);

async function submit(): Promise<void> {
  // Complete by now: the form's validation passed.
  const { expense: read } = reading.value;
  if (!read) return;
  saving.value = true;
  // Based on the Repayment as the form read it when it opened.
  const refused = await saveExpense(read, repayment).finally(() => (saving.value = false));

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
      :validate="() => formErrors(reading.reasons, state)"
      class="space-y-5"
      @submit="submit"
    >
      <div class="card px-4 pt-3 pb-3.5">
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
        <UFormField name="mainPayerId" :error="problemAt(reading.reasons, 'mainPayerId')">
          <ParticipantPicker
            v-model="state.mainPayerId"
            :participants="trip.participants"
            :label="$t('expense.paidBy')"
            name="mainPayerId"
          />
        </UFormField>

        <UFormField name="recipientId" :error="problemAt(reading.reasons, 'recipientId')">
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
      </div>
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
