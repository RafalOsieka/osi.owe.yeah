<script setup lang="ts">
import type { VNode } from 'vue';
import { roundMoney, type Participant, type SuggestedRepayment } from '@osi/owe-yeah-domain';

// Suggested Repayments, one row pattern wherever they show: the avatars, who pays whom over
// the amount, both in full, and Record, which opens the Repayment form filled with it. One
// that involves the claimed Participant reads from their side ("Marek pays you", "You pay
// Kasia") with the other's avatar; any other shows both avatars, overlapping ("Kasia pays
// Bartek"). Record is solid only on what the claimed Participant pays, their own to-do. The
// `action` slot adds a button (Remind) beside Record: the two then share a row under the
// amount, so neither squeezes the names. The suggestion `highlight` names
// (`payerId→recipientId`, as `suggestionKey` writes it), e.g. the one a tapped Reminder is
// about, is marked and scrolled to. Bare rows: the caller puts them on a card.
const {
  suggestions,
  participants,
  tripId,
  currency,
  claimId = null,
  highlight = null,
} = defineProps<{
  suggestions: readonly SuggestedRepayment[];
  participants: readonly Participant[];
  tripId: string;
  currency: string;
  claimId?: string | null;
  highlight?: string | null;
}>();
defineSlots<{ action?: (props: { suggestion: SuggestedRepayment }) => VNode[] }>();

const { t, locale } = useI18n();

const rows = computed(() => {
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  return suggestions.map((suggestion) => {
    const { payerId, recipientId, amount } = suggestion;
    const payer = byId.get(payerId);
    const recipient = byId.get(recipientId);
    const own = payerId === claimId || recipientId === claimId;
    let text: string;
    if (payerId === claimId) text = t('balances.youPay', { name: recipient?.name ?? '?' });
    else if (recipientId === claimId) text = t('balances.paysYou', { name: payer?.name ?? '?' });
    else {
      text = t('balances.pays', { payer: payer?.name ?? '?', recipient: recipient?.name ?? '?' });
    }
    const money = formatMoney(amount, currency, locale.value);
    return {
      suggestion,
      key: suggestionKey(suggestion),
      yours: payerId === claimId,
      // The other side of one's own suggestion; both sides otherwise.
      avatars: own ? [payerId === claimId ? recipient : payer] : [payer, recipient],
      text,
      money,
      record: {
        path: `/trips/${tripId}/repayments/new`,
        query: {
          payer: payerId,
          recipient: recipientId,
          amount: roundMoney(amount, currency).decimal,
        },
      },
    };
  });
});

const rowId = (key: string) => `suggestion-${key}`;
// Also when a Reminder is tapped while Balances is open already.
watch(
  () => highlight,
  (key) => key && document.getElementById(rowId(key))?.scrollIntoView({ block: 'center' }),
  { immediate: true, flush: 'post' },
);
</script>

<template>
  <ul>
    <li
      v-for="row in rows"
      :id="rowId(row.key)"
      :key="row.key"
      class="border-b border-default px-4 py-3 last:border-b-0"
      :class="{ 'bg-primary/8': row.key === highlight }"
      :aria-current="row.key === highlight ? 'true' : undefined"
    >
      <div class="flex items-center gap-3">
        <span class="flex shrink-0 items-center">
          <template v-for="(avatar, index) in row.avatars" :key="index">
            <ParticipantAvatar
              v-if="avatar"
              :participant="avatar"
              size="md"
              :class="{ '-ms-2 ring-2 ring-(--ui-bg)': index > 0 }"
            />
          </template>
        </span>
        <span class="min-w-0 flex-1 leading-snug">
          <span class="block text-highlighted wrap-anywhere">{{ row.text }}</span>
          <span class="block font-semibold text-highlighted tabular-nums">{{ row.money }}</span>
        </span>
        <UButton
          v-if="!$slots.action"
          :to="row.record"
          :variant="row.yours ? 'solid' : 'soft'"
          :label="$t('balances.record')"
          :aria-label="$t('balances.recordLabel', { what: row.text, amount: row.money })"
          class="shrink-0 px-5"
        />
      </div>
      <div v-if="$slots.action" class="ms-13 mt-3 grid grid-cols-2 gap-2">
        <slot name="action" :suggestion="row.suggestion" />
        <UButton
          :to="row.record"
          :variant="row.yours ? 'solid' : 'soft'"
          :label="$t('balances.record')"
          :aria-label="$t('balances.recordLabel', { what: row.text, amount: row.money })"
        />
      </div>
    </li>
  </ul>
</template>
