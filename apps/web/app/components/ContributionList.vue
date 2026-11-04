<script setup lang="ts">
import type { Participant, Rational } from '@osi/owe-yeah-domain';
import type { DropdownMenuItem } from '@nuxt/ui';
import type { DraftContribution } from '~/utils/expense-draft';

// The Contributions of an Expense on its form, under "Paid by": one row per Participant who
// paid a fixed amount towards it, with the amount as typed and a remove button, and "Add a
// Contribution" to pick someone else who hasn't made one and isn't the Main payer. Below the
// rows, what the Main payer covers once the Contributions are taken off the total (`rest`,
// `null` while it can't be read). Contributions that come to more than the total are a Trip
// rule broken, which the form shows at the field.
const { participants, mainPayerId, currency, rest } = defineProps<{
  participants: readonly Participant[];
  mainPayerId: string;
  currency: string;
  rest: Rational | null;
}>();
const contributions = defineModel<DraftContribution[]>({ required: true });

const { locale } = useI18n();
const labelId = useId();
const inputId = (participantId: string) => `${labelId}-${participantId}`;

const rows = computed(() =>
  contributions.value.flatMap((contribution) => {
    const participant = participants.find(({ id }) => id === contribution.participantId);
    return participant ? [{ participant, amount: contribution.amount }] : [];
  }),
);

const payerName = computed(() => participants.find(({ id }) => id === mainPayerId)?.name ?? '?');

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
    <div v-if="rows.length > 0" role="group" :aria-labelledby="labelId" class="mb-1.5">
      <p :id="labelId" class="mb-1.5 text-sm font-medium">{{ $t('contribution.title') }}</p>
      <ul class="space-y-1.5">
        <li v-for="row in rows" :key="row.participant.id" class="flex items-center gap-2">
          <ParticipantAvatar :participant="row.participant" size="2xs" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ row.participant.name }}</span>
          <UInput
            :id="inputId(row.participant.id)"
            :model-value="row.amount"
            inputmode="decimal"
            placeholder="0"
            :aria-label="$t('contribution.amountFrom', { name: row.participant.name })"
            class="w-32"
            @update:model-value="setAmount(row.participant.id, String($event))"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="$t('contribution.remove', { name: row.participant.name })"
            @click="remove(row.participant.id)"
          />
        </li>
      </ul>
      <p v-if="rest && rest.numerator >= 0n" class="mt-1.5 text-sm text-muted">
        {{
          $t('contribution.rest', {
            name: payerName,
            amount: formatMoney(rest, currency, locale),
          })
        }}
      </p>
    </div>
    <UDropdownMenu
      v-if="addable.length > 0"
      :items="addable"
      :content="{ onCloseAutoFocus: focusAdded }"
    >
      <UButton
        icon="i-lucide-plus"
        variant="link"
        size="sm"
        :label="$t('contribution.add')"
        class="p-0"
      />
    </UDropdownMenu>
  </div>
</template>
