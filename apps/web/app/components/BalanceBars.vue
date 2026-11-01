<script setup lang="ts">
import type { Participant, ParticipantBalance } from '@osi/owe-yeah-domain';

// Everyone's balance as diverging bars, one per Participant in the Trip's order: owing to
// the left in red, owed to the right in green, scaled to the largest balance, with the
// amount at the end of the bar. Shows the rounded balances settling up uses. Hand-built: `UChart` only draws vertical bars.
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

const { locale } = useI18n();

const rows = computed(() => {
  const names = new Map(participants.map(({ id, name }) => [id, name]));
  const widths = barWidths(balances.map(({ rounded }) => rounded));
  const amounts = balances.map(({ rounded }) =>
    formatMoney(rounded, currency, locale.value, 'signed'),
  );
  // A bar shares its half with its amount, so every bar leaves room for the longest amount
  // (in `ch`: the digits are tabular) plus its padding, and all keep the same scale.
  const longest = Math.max(0, ...amounts.map((amount) => amount.length));
  return balances.map(({ participantId, rounded }, index) => {
    const sign = shownSign(rounded, currency);
    return {
      participantId,
      name: names.get(participantId) ?? '?',
      owes: sign < 0,
      amount: amounts[index]!,
      width: `calc((100% - ${longest}ch - 0.5rem) * ${widths[index]! / 100})`,
    };
  });
});
</script>

<template>
  <div>
    <div class="flex justify-between ps-16 text-xs text-dimmed" aria-hidden="true">
      <span>{{ $t('balances.owes') }}</span>
      <span>{{ $t('balances.isOwed') }}</span>
    </div>
    <ul>
      <li
        v-for="row in rows"
        :key="row.participantId"
        class="grid h-8 grid-cols-[4rem_1fr_1fr] items-center text-xs"
      >
        <span
          class="truncate pe-1"
          :class="row.participantId === claimId ? 'font-bold' : 'font-medium'"
        >
          {{ row.name }}
        </span>
        <span
          class="flex h-full min-w-0 items-center justify-end overflow-hidden border-e-[1.5px] border-accented"
        >
          <template v-if="row.owes">
            <span class="px-1 whitespace-nowrap text-muted tabular-nums">{{ row.amount }}</span>
            <span class="h-4 shrink-0 rounded-s bg-error/85" :style="{ width: row.width }" />
          </template>
        </span>
        <span class="flex h-full min-w-0 items-center overflow-hidden">
          <template v-if="!row.owes">
            <span class="h-4 shrink-0 rounded-e bg-success/85" :style="{ width: row.width }" />
            <span class="px-1 whitespace-nowrap text-muted tabular-nums">{{ row.amount }}</span>
          </template>
        </span>
      </li>
    </ul>
  </div>
</template>
