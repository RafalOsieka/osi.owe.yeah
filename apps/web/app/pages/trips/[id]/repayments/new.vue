<script setup lang="ts">
import { participantIdSchema } from '@osi/owe-yeah-domain';
import { z } from 'zod';

// New Repayment: the Repayment form, opened from the Balances tab. A Suggested Repayment's
// Record passes its payer, recipient and amount in the query (`payer`, `recipient`, `amount`).
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip } = useOpenTrip();
const { t } = useI18n();
const route = useRoute();

// Anything malformed in the query is left out, and the form starts without it.
const querySchema = z.object({
  payer: participantIdSchema.optional().catch(undefined),
  recipient: participantIdSchema.optional().catch(undefined),
  amount: z.string().optional().catch(undefined),
});
// Read once, like the form.
const { payer, recipient, amount } = querySchema.parse(route.query);
const suggested = { payerId: payer, recipientId: recipient, amount };

useHead({ title: () => t('repayment.new') });
</script>

<template>
  <RepaymentForm :suggested="suggested" :parent="`/trips/${trip.id}/balances`" />
</template>
