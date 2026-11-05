<script setup lang="ts">
import type { Participant, ParticipantBalance } from '@osi/owe-yeah-domain';

// Everyone's balance, one row per Participant in the Trip's order: their avatar, name and
// signed amount, over a full-width track with a diverging bar from its marked centre (the
// two directions named once on top), owing to the left in red and owed to the right in
// green, scaled to the largest balance. Shows the rounded balances settling up uses. Tapping
// a row (a chevron says so) selects its Participant, to open their breakdown. Without `bars`,
// e.g. once everyone is at zero, the rows keep only the name and the amount. Hand-built:
// `UChart` only draws vertical bars.
const {
  balances,
  participants,
  currency,
  claimId = null,
  bars = true,
} = defineProps<{
  /** In the Trip's order, as `balances()` gives them. */
  balances: readonly ParticipantBalance[];
  participants: readonly Participant[];
  currency: string;
  claimId?: string | null;
  bars?: boolean;
}>();
const emit = defineEmits<{ select: [participantId: string] }>();

const { locale } = useI18n();

const rows = computed(() => {
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  const widths = barWidths(balances.map(({ rounded }) => rounded));
  return balances.map(({ participantId, rounded }, index) => {
    const sign = shownSign(rounded, currency);
    // Half the track at most, from its centre.
    const half = widths[index]! / 2;
    return {
      participantId,
      participant: byId.get(participantId),
      name: byId.get(participantId)?.name ?? '?',
      amount: formatMoney(rounded, currency, locale.value, 'signedCurrency'),
      tone: sign < 0 ? 'text-error' : sign > 0 ? 'text-success' : 'text-muted',
      bar: {
        class: sign < 0 ? 'rounded-s-full bg-error/80' : 'rounded-e-full bg-success',
        style: { insetInlineStart: sign < 0 ? `${50 - half}%` : '50%', width: `${half}%` },
      },
    };
  });
});
</script>

<template>
  <div class="card overflow-hidden">
    <p
      v-if="bars"
      class="flex justify-between px-4 pt-3 text-sm font-medium text-toned"
      aria-hidden="true"
    >
      <span class="flex items-center gap-1.5">
        <UIcon name="i-lucide-arrow-left" class="size-4 text-error" />
        {{ $t('balances.owes') }}
      </span>
      <span class="flex items-center gap-1.5">
        {{ $t('balances.isOwed') }}
        <UIcon name="i-lucide-arrow-right" class="size-4 text-success" />
      </span>
    </p>
    <ul class="divide-y divide-default">
      <li v-for="row in rows" :key="row.participantId">
        <button
          type="button"
          aria-haspopup="dialog"
          class="w-full cursor-pointer px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated"
          @click="emit('select', row.participantId)"
        >
          <span class="flex items-center gap-3">
            <ParticipantAvatar v-if="row.participant" :participant="row.participant" size="md" />
            <span class="min-w-0 flex-1 truncate text-highlighted">
              {{ row.name }}
              <YouBadge v-if="row.participantId === claimId" />
            </span>
            <span class="shrink-0 font-medium tabular-nums" :class="row.tone">
              {{ row.amount }}
            </span>
            <UIcon
              name="i-lucide-chevron-right"
              class="-me-1 size-4 shrink-0 text-dimmed"
              aria-hidden="true"
            />
          </span>
          <span
            v-if="bars"
            class="relative mt-2.5 block h-1.5 rounded-full bg-elevated"
            aria-hidden="true"
          >
            <span
              class="absolute -inset-y-1 start-1/2 w-0.5 -translate-x-1/2 rounded-full bg-neutral-400 dark:bg-neutral-500"
            />
            <span class="absolute inset-y-0" :class="row.bar.class" :style="row.bar.style" />
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
