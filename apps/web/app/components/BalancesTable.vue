<script setup lang="ts">
import { balances, type Rational, type TripSnapshot } from '@osi/owe-yeah-domain';

// What each Participant paid, their share, and their balance, worked out exactly and
// rounded only here, for display ("≈" marks amounts rounding changed).
const { trip, claimId = null } = defineProps<{ trip: TripSnapshot; claimId?: string | null }>();

const { locale } = useI18n();

const rows = computed(() => {
  const names = new Map(trip.participants.map(({ id, name }) => [id, name]));
  const money = (amount: Rational) => formatMoney(amount, trip.currency, locale.value);
  return balances(trip).map(({ participantId, paid, share, balance }) => ({
    participantId,
    name: names.get(participantId),
    paid: money(paid),
    share: money(share),
    balance: money(balance),
    sign: balance.numerator > 0n ? 1 : balance.numerator < 0n ? -1 : 0,
  }));
});
</script>

<template>
  <table class="w-full text-sm">
    <thead class="text-left text-muted">
      <tr>
        <th scope="col" class="py-1 font-medium">{{ $t('balances.participant') }}</th>
        <th scope="col" class="py-1 text-right font-medium">{{ $t('balances.paid') }}</th>
        <th scope="col" class="py-1 text-right font-medium">{{ $t('balances.share') }}</th>
        <th scope="col" class="py-1 text-right font-medium">{{ $t('balances.balance') }}</th>
      </tr>
    </thead>
    <tbody class="tabular-nums">
      <tr
        v-for="row in rows"
        :key="row.participantId"
        :class="{ 'font-semibold': row.participantId === claimId }"
      >
        <th scope="row" class="py-1 text-left font-medium">{{ row.name }}</th>
        <td class="py-1 text-right">{{ row.paid }}</td>
        <td class="py-1 text-right">{{ row.share }}</td>
        <td
          class="py-1 text-right"
          :class="{ 'text-success': row.sign > 0, 'text-error': row.sign < 0 }"
        >
          {{ row.balance }}
        </td>
      </tr>
    </tbody>
  </table>
</template>
