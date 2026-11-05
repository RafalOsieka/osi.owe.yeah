<script setup lang="ts">
import type { Participant, Rational } from '@osi/owe-yeah-domain';
import type { DropdownMenuItem } from '@nuxt/ui';
import type { DraftContribution } from '~/utils/expense-draft';

// The Contributions of an Expense on its form, under "Paid by", as one small ledger of who pays
// what: a row per Participant who paid a fixed amount towards it, with the amount as typed (in
// the Expense currency) and a remove button, then the Main payer's row with what they cover
// once the Contributions come off the total (`rest`, `null` while it can't be read). "Add a
// Contribution" picks someone else who hasn't made one and isn't the Main payer. Contributions
// that come to more than the total are a Trip rule broken, which the form shows at the field.
const { participants, mainPayerId, currency, rest } = defineProps<{
  participants: readonly Participant[];
  mainPayerId: string;
  currency: string;
  rest: Rational | null;
}>();
const contributions = defineModel<DraftContribution[]>({ required: true });

const { locale } = useI18n();
const { claim } = useOpenTrip();
const labelId = useId();
const inputId = (participantId: string) => `${labelId}-${participantId}`;

const rows = computed(() =>
  contributions.value.flatMap((contribution) => {
    const participant = participants.find(({ id }) => id === contribution.participantId);
    return participant ? [{ participant, amount: contribution.amount }] : [];
  }),
);

const payer = computed(() => participants.find(({ id }) => id === mainPayerId));

function setAmount(participantId: string, amount: string): void {
  contributions.value = contributions.value.map((contribution) =>
    contribution.participantId === participantId ? { participantId, amount } : contribution,
  );
}

function remove(participantId: string): void {
  // The menu may show again; no amount is waiting for focus.
  added = undefined;
  contributions.value = contributions.value.filter(
    (contribution) => contribution.participantId !== participantId,
  );
}

// Who was just added: their amount takes focus as soon as it shows, and again once the menu
// closes, rather than the menu's button. Adding the last one left removes the menu instead.
let added: string | undefined;
const focusAmount = (participantId: string) =>
  document.getElementById(inputId(participantId))?.focus();

function focusAdded(event: Event): void {
  if (!added) return;
  event.preventDefault();
  focusAmount(added);
  added = undefined;
}

// Everyone who could still contribute, in the Trip's order.
const addable = computed<DropdownMenuItem[]>(() =>
  participants
    .filter(
      ({ id }) =>
        id !== mainPayerId &&
        !contributions.value.some(({ participantId }) => participantId === id),
    )
    .map((participant) => ({
      label: participant.name,
      onSelect: async () => {
        contributions.value = [
          ...contributions.value,
          { participantId: participant.id, amount: '' },
        ];
        added = participant.id;
        await nextTick();
        focusAmount(participant.id);
      },
    })),
);
</script>

<template>
  <div>
    <div v-if="rows.length > 0" role="group" :aria-labelledby="labelId" class="mb-1">
      <p :id="labelId" class="mb-2 text-sm font-medium text-highlighted">
        {{ $t('contribution.title') }}
      </p>
      <ul class="divide-y divide-default">
        <li
          v-for="row in rows"
          :key="row.participant.id"
          class="flex items-center gap-2.5 py-2 first:pt-0"
        >
          <ParticipantAvatar :participant="row.participant" size="xs" />
          <span class="flex min-w-0 flex-1 items-center text-sm font-medium">
            <span class="truncate">{{ row.participant.name }}</span>
            <YouBadge v-if="row.participant.id === claim?.id" />
          </span>
          <MoneyInput
            :id="inputId(row.participant.id)"
            :model-value="row.amount"
            :currency="currency"
            :aria-label="$t('contribution.amountFrom', { name: row.participant.name })"
            class="w-36"
            @update:model-value="setAmount(row.participant.id, $event)"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            :aria-label="$t('contribution.remove', { name: row.participant.name })"
            class="-me-2"
            @click="remove(row.participant.id)"
          />
        </li>
        <!-- The Main payer covers whatever the Contributions leave. -->
        <li v-if="payer" class="flex min-h-13 items-center gap-2.5 pt-2">
          <ParticipantAvatar :participant="payer" size="xs" />
          <span class="min-w-0 flex-1 text-sm text-muted">
            {{ $t('contribution.rest', { name: payer.name }) }}
            <YouBadge v-if="payer.id === claim?.id" />
          </span>
          <span
            v-if="rest && rest.numerator >= 0n"
            class="pe-[2.875rem] font-semibold text-highlighted tabular-nums"
          >
            {{ formatMoney(rest, currency, locale) }}
          </span>
        </li>
      </ul>
    </div>
    <UDropdownMenu
      v-if="addable.length > 0"
      :items="addable"
      :content="{ onCloseAutoFocus: focusAdded }"
    >
      <UButton icon="i-lucide-plus" variant="link" :label="$t('contribution.add')" class="-ms-3" />
    </UDropdownMenu>
  </div>
</template>
