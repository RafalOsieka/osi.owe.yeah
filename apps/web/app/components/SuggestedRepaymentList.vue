<script setup lang="ts">
import { roundMoney, type Participant, type SuggestedRepayment } from '@osi/owe-yeah-domain';

// Suggested Repayments, each with Record, which opens the Repayment form filled with it.
// One that involves the claimed Participant reads from their side ("Marek pays you",
// "You pay Kasia") with the other's avatar; any other shows both avatars ("Kasia pays
// Bartek").
const {
  suggestions,
  participants,
  tripId,
  currency,
  claimId = null,
} = defineProps<{
  suggestions: readonly SuggestedRepayment[];
  participants: readonly Participant[];
  tripId: string;
  currency: string;
  claimId?: string | null;
}>();

const { t, locale } = useI18n();

const rows = computed(() => {
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  return suggestions.map(({ payerId, recipientId, amount }) => {
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
      key: `${payerId}→${recipientId}`,
      own,
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
</script>

<template>
  <ul>
    <li v-for="row in rows" :key="row.key" class="flex items-center gap-2.5 py-2">
      <span class="flex shrink-0 items-center gap-1">
        <template v-for="(avatar, index) in row.avatars" :key="index">
          <UIcon v-if="index > 0" name="i-lucide-arrow-right" class="size-3 text-muted" />
          <ParticipantAvatar v-if="avatar" :participant="avatar" />
        </template>
      </span>
      <span class="min-w-0 flex-1 leading-snug">
        <span class="block truncate text-sm">{{ row.text }}</span>
        <span class="block font-semibold tabular-nums">{{ row.money }}</span>
      </span>
      <UButton
        :to="row.record"
        :variant="row.own ? 'solid' : 'outline'"
        :label="$t('balances.record')"
        :aria-label="$t('balances.recordLabel', { what: row.text, amount: row.money })"
        class="shrink-0"
      />
    </li>
  </ul>
</template>
