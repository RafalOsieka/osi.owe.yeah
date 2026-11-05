<script setup lang="ts">
import type { Participant, ParticipantBalance } from '@osi/owe-yeah-domain';

// Everyone's balance as diverging bars, one per Participant in the Trip's order with their
// avatar: owing to the left in red, owed to the right in green, scaled to the largest balance, with the
// amount at the end of the bar. Shows the rounded balances settling up uses. Tapping a bar
// selects its Participant, to open their breakdown. Hand-built: `UChart` only draws vertical
// bars.
const {
  balances,
  participants,
  currency,
  claimId = null,
} = defineProps<{
  /** In the Trip's order, as `balances()` gives them. */
  balances: readonly ParticipantBalance[];
  participants: readonly Participant[];
  currency: string;
  claimId?: string | null;
}>();
const emit = defineEmits<{ select: [participantId: string] }>();

const { locale } = useI18n();

const rows = computed(() => {
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  const widths = barWidths(balances.map(({ rounded }) => rounded));
  // With a true minus sign, which is as wide as the plus.
  const amounts = balances.map(({ rounded }) =>
    formatMoney(rounded, currency, locale.value, 'signedCurrency').replace('-', '−'),
  );
  // A bar shares its half with its amount, so every bar leaves room for the longest amount
  // (in `ch`: the digits are tabular) plus its padding, and all keep the same scale.
  const longest = Math.max(0, ...amounts.map((amount) => amount.length));
  return balances.map(({ participantId, rounded }, index) => {
    const sign = shownSign(rounded, currency);
    return {
      participantId,
      participant: byId.get(participantId),
      name: byId.get(participantId)?.name ?? '?',
      owes: sign < 0,
      amount: amounts[index]!,
      width: `calc((100% - ${longest}ch - 0.5rem) * ${widths[index]! / 100})`,
    };
  });
});
</script>

<template>
  <div class="card px-2 py-3">
    <div class="mb-1 grid grid-cols-[6.5rem_1fr_1fr] px-2 text-xs text-dimmed" aria-hidden="true">
      <span />
      <span class="pe-2 text-end">{{ $t('balances.owes') }}</span>
      <span class="ps-2">{{ $t('balances.isOwed') }}</span>
    </div>
    <ul>
      <li v-for="row in rows" :key="row.participantId">
        <button
          type="button"
          aria-haspopup="dialog"
          class="grid h-11 w-full cursor-pointer grid-cols-[6.5rem_1fr_1fr] items-center rounded-lg px-2 text-start text-sm transition-colors hover:bg-elevated/60 active:bg-elevated"
          @click="emit('select', row.participantId)"
        >
          <span class="flex min-w-0 items-center gap-2 pe-2">
            <ParticipantAvatar v-if="row.participant" :participant="row.participant" size="xs" />
            <span
              class="truncate"
              :class="
                row.participantId === claimId ? 'font-semibold text-highlighted' : 'text-default'
              "
            >
              {{ row.name }}
            </span>
          </span>
          <span
            class="flex h-full min-w-0 items-center justify-end overflow-hidden border-e border-accented"
          >
            <template v-if="row.owes">
              <span class="px-1.5 text-xs whitespace-nowrap text-muted tabular-nums">
                {{ row.amount }}
              </span>
              <span class="h-3 shrink-0 rounded-s-full bg-error/75" :style="{ width: row.width }" />
            </template>
          </span>
          <span class="flex h-full min-w-0 items-center overflow-hidden">
            <template v-if="!row.owes">
              <span
                class="h-3 shrink-0 rounded-e-full bg-success/80"
                :style="{ width: row.width }"
              />
              <span class="px-1.5 text-xs whitespace-nowrap text-muted tabular-nums">
                {{ row.amount }}
              </span>
            </template>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
