<script setup lang="ts">
import { deviceTimeZone, type Repayment } from '@osi/owe-yeah-domain';
import type { RouteLocationRaw } from 'vue-router';
import type { LocalExpense } from '~/sync/local-trip';
import {
  draftChanged,
  draftFromExpense,
  newRepaymentDraft,
  pickMainPayer,
  readDraft,
  stillSuggested,
  type RepaymentDraft,
  type RepaymentSuggestion,
} from '~/utils/expense-draft';

// The full-screen Repayment form, for a new Repayment or to edit one, in the Expense form's
// order: amount with its currency beside it and a Manual rate if needed (`ExpenseCurrency`),
// closed by who pays whom ("Ania → Marta", "you" marked), then who paid, who got the money
// (never who paid: picking them as payer swaps the two) and when, and last an optional note.
// The note is the title, "Repayment" when left empty. A new one is in the Trip currency until
// another is picked, and may start from a Suggested Repayment (`suggested`), which it says it
// settles ("what you owe Marta" where it is yours) while it still matches; its amount stays
// editable for a partial Repayment. Otherwise who paid defaults to the Claim. Reading and
// saving work like the Expense form's. The rules live in the Expense draft (`pickMainPayer`,
// `RepaymentDraft`, `stillSuggested`); the form only renders and forwards. Leaving it changed
// asks first (`useDiscardConfirm`).
const {
  repayment = null,
  suggested = null,
  parent,
} = defineProps<{
  repayment?: Extract<LocalExpense, Repayment> | null;
  /** What a new Repayment starts with; any part may be missing. */
  suggested?: RepaymentSuggestion | null;
  /** The screen above the form, for back when it was opened from a link. */
  parent: RouteLocationRaw;
}>();

const { trip, claim, saveExpense } = useOpenTrip();
const { t } = useI18n();
const back = useBack();
const { formErrors, problemAt } = useDraftReasons();

const defaultTitle = t('repayment.title');

// The heading, which also titles the tab.
const heading = computed(() => (repayment ? t('repayment.edit') : t('repayment.new')));
useHead({ title: heading });

// Read once: the form is mounted afresh each time it opens. What it started with is kept apart,
// to tell whether anything was changed.
const start: RepaymentDraft = repayment
  ? draftFromExpense(repayment, trip.value, defaultTitle)
  : newRepaymentDraft(trip.value, {
      now: new Date(),
      zone: deviceTimeZone(),
      claimId: claim.value?.id ?? null,
      defaultTitle,
      suggested,
    });
const state = reactive(structuredClone(start));

// What is typed, read live and when saving.
const reading = computed(() => readDraft(state, trip.value));

const nameOf = (id: string) => trip.value.participants.find((participant) => participant.id === id);
const payer = computed(() => nameOf(state.mainPayerId));
const recipient = computed(() => nameOf(state.recipientId));

function pickPayer(participantId: string): void {
  Object.assign(state, pickMainPayer(state, participantId));
}

const settles = computed(() => stillSuggested(state, suggested));

const { open: discarding, discard, leave } = useDiscardConfirm(() => draftChanged(start, state));

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
  if (refused.length > 0) return;
  leave();
  await back(parent);
}
</script>

<template>
  <NuxtLayout name="form" :title="heading" :parent="parent" :close="!repayment">
    <UForm
      id="repayment-form"
      :state="state"
      :validate="() => formErrors(reading.reasons, state)"
      class="space-y-5"
      @submit="submit"
    >
      <div class="card relative px-4 pt-3 pb-4">
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
        <div
          v-if="payer && recipient && payer.id !== recipient.id"
          class="-mx-4 mt-4 border-t border-default px-4 pt-3.5 text-center"
        >
          <p class="sr-only">
            {{ $t('repayment.fromTo', { payer: payer.name, recipient: recipient.name }) }}
          </p>
          <p
            class="flex items-center justify-center gap-2 font-medium text-highlighted"
            aria-hidden="true"
          >
            <ParticipantAvatar :participant="payer" size="xs" />
            <span class="flex min-w-0 items-center">
              <span class="truncate">{{ payer.name }}</span>
              <YouBadge v-if="payer.id === claim?.id" />
            </span>
            <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 text-muted" />
            <ParticipantAvatar :participant="recipient" size="xs" />
            <span class="flex min-w-0 items-center">
              <span class="truncate">{{ recipient.name }}</span>
              <YouBadge v-if="recipient.id === claim?.id" />
            </span>
          </p>
          <p v-if="settles" class="mt-1 text-sm text-muted">
            {{
              payer.id === claim?.id
                ? $t('repayment.settlesYours', { recipient: recipient.name })
                : recipient.id === claim?.id
                  ? $t('repayment.settlesToYou', { payer: payer.name })
                  : $t('repayment.settles', { payer: payer.name, recipient: recipient.name })
            }}
          </p>
        </div>
      </div>

      <div class="card space-y-6 p-4">
        <UFormField name="mainPayerId" :error="problemAt(reading.reasons, 'mainPayerId')">
          <ParticipantPicker
            :model-value="state.mainPayerId"
            :participants="trip.participants"
            :label="$t('expense.paidBy')"
            name="mainPayerId"
            @update:model-value="pickPayer"
          />
        </UFormField>

        <UFormField name="recipientId" :error="problemAt(reading.reasons, 'recipientId')">
          <ParticipantPicker
            v-model="state.recipientId"
            :participants="trip.participants"
            :label="$t('repayment.paidTo')"
            :unavailable-id="state.mainPayerId"
            name="recipientId"
          />
        </UFormField>

        <ExpenseTimeField v-model:local="state.local" v-model:zone="state.zone" />
      </div>

      <div class="card p-4">
        <UFormField name="title" :label="$t('repayment.note')" :hint="$t('form.optional')">
          <UInput
            v-model="state.title"
            :placeholder="$t('repayment.notePlaceholder')"
            class="w-full"
          />
        </UFormField>
      </div>
    </UForm>

    <DiscardSheet
      v-model:open="discarding"
      :title="repayment ? $t('discard.changes') : $t('discard.newRepayment')"
      :draft="state"
      :total="reading.total"
      @discard="discard"
    />

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
