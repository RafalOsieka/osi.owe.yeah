<script setup lang="ts">
import {
  balances,
  isSettled,
  participantIdSchema,
  rateSummary,
  shareBreakdowns,
  spendingTotal,
  suggestedRepayments,
} from '@osi/owe-yeah-domain';
import { z } from 'zod';

// The Balances tab: your balance and your own Suggested Repayments ("To settle") first, then
// everyone's balance as diverging bars, the other Suggested Repayments (all of them without
// a Claim), Record another Repayment, and what the Trip spent. Once the Trip is Settled, "All
// settled" replaces the balance and the suggestions. Balances are worked out exactly and
// rounded with the largest remainder method, as settling up uses them, in the Trip currency.
// The footer warns how many Expenses use a Provisional rate, so balances may still move a
// little (settling up stays allowed), and how many are left out without any rate. Tapping a
// bar opens where that Participant's share comes from, with what they paid and their balance.
// On the claimed Participant's suggestions as creditor, Remind reminds the debtor (#42).
// Opened from a Reminder, `?payer=<id>&recipient=<id>` marks the suggestion it was about,
// Record one tap away, until the tab is opened again: the address loses it at once.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim } = useOpenTrip();
const { locale } = useI18n();
const route = useRoute();
const router = useRouter();
const reminders = useReminders();

// The suggestion a tapped Reminder is about.
const reminderQuerySchema = z.object({
  payer: participantIdSchema,
  recipient: participantIdSchema,
});
const highlight = ref<string | null>(null);
watch(
  () => route.query,
  (current) => {
    const reminded = reminderQuerySchema.safeParse(current);
    if (!reminded.success) return;
    const { payer, recipient } = reminded.data;
    highlight.value = suggestionKey({ payerId: payer, recipientId: recipient });
    const { payer: _, recipient: __, ...query } = current;
    void router.replace({ query, hash: route.hash });
  },
  { immediate: true },
);

const everyone = computed(() => balances(trip.value));
const settled = computed(() => isSettled(trip.value));
const mine = computed(
  () => everyone.value.find(({ participantId }) => participantId === claim.value?.id) ?? null,
);
const total = computed(() => spendingTotal(trip.value));
const rates = computed(() => rateSummary(trip.value));

const breakdownOpen = ref(false);
const breakdownOf = ref<string | null>(null);
const opened = computed(() => {
  const participant = trip.value.participants.find(({ id }) => id === breakdownOf.value);
  const balance = everyone.value.find(({ participantId }) => participantId === breakdownOf.value);
  const breakdown = participant && shareBreakdowns(trip.value).get(participant.id);
  return participant && balance && breakdown ? { participant, balance, breakdown } : null;
});
useCloseOnBack(breakdownOpen);

function openBreakdown(participantId: string): void {
  breakdownOf.value = participantId;
  breakdownOpen.value = true;
}

const suggestions = computed(() => {
  const all = suggestedRepayments(everyone.value);
  const claimId = claim.value?.id;
  const own = ({ payerId, recipientId }: (typeof all)[number]) =>
    payerId === claimId || recipientId === claimId;
  return { own: all.filter(own), others: all.filter((suggestion) => !own(suggestion)) };
});

const nameOf = (participantId: string) =>
  trip.value.participants.find(({ id }) => id === participantId)?.name ?? '?';
</script>

<template>
  <NuxtLayout name="trip">
    <section
      v-if="settled"
      class="flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3.5 text-success"
    >
      <UIcon name="i-lucide-circle-check" class="size-8 shrink-0" />
      <div>
        <h2 class="text-xl font-bold">{{ $t('balances.allSettled') }}</h2>
        <p class="text-xs">{{ $t('balances.allSettledHelp') }}</p>
      </div>
    </section>
    <template v-else>
      <BalanceCard :balance="mine" :total="total" :currency="trip.currency" />

      <section v-if="suggestions.own.length > 0" aria-labelledby="to-settle-heading">
        <h2
          id="to-settle-heading"
          class="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase"
        >
          {{ $t('balances.toSettle') }}
        </h2>
        <SuggestedRepaymentList
          :suggestions="suggestions.own"
          :participants="trip.participants"
          :trip-id="trip.id"
          :currency="trip.currency"
          :claim-id="claim?.id"
          :highlight="highlight"
        >
          <template #detail="{ suggestion }">
            <span
              v-if="
                suggestion.recipientId === claim?.id &&
                ['share', 'copy'].includes(reminders.by(suggestion.payerId))
              "
              class="block text-xs text-muted"
            >
              {{
                reminders.by(suggestion.payerId) === 'share'
                  ? $t('reminder.byShare')
                  : $t('reminder.byCopy')
              }}
            </span>
          </template>
          <template #action="{ suggestion }">
            <RemindButton
              v-if="suggestion.recipientId === claim?.id"
              :by="reminders.by(suggestion.payerId)"
              :debtor="nameOf(suggestion.payerId)"
              :sending="reminders.sending.value === suggestion.payerId"
              @remind="reminders.remind(suggestion)"
            />
          </template>
        </SuggestedRepaymentList>
      </section>
    </template>

    <section aria-labelledby="everyone-heading">
      <h2
        id="everyone-heading"
        class="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase"
      >
        {{ $t('balances.everyone') }}
      </h2>
      <BalanceBars
        :balances="everyone"
        :participants="trip.participants"
        :currency="trip.currency"
        :claim-id="claim?.id"
        @select="openBreakdown"
      />
    </section>

    <section v-if="!settled && suggestions.others.length > 0" aria-labelledby="suggestions-heading">
      <h2
        id="suggestions-heading"
        class="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase"
      >
        {{ claim ? $t('balances.otherSuggestions') : $t('balances.suggestions') }}
      </h2>
      <SuggestedRepaymentList
        :suggestions="suggestions.others"
        :participants="trip.participants"
        :trip-id="trip.id"
        :currency="trip.currency"
        :claim-id="claim?.id"
        :highlight="highlight"
      />
    </section>

    <UButton
      variant="link"
      icon="i-lucide-plus"
      :label="$t('balances.recordAnother')"
      :to="`/trips/${trip.id}/repayments/new`"
      class="mt-3 px-0"
    />

    <div class="mt-4 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
      <p>
        {{
          $t('balances.tripTotalIs', {
            amount: formatMoney(total, trip.currency, locale, 'currency', rates.provisional > 0),
          })
        }}
      </p>
      <p v-if="rates.provisional > 0" class="flex items-center gap-1">
        <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 text-warning" />
        {{ $t('rate.provisionalCount', rates.provisional) }}
      </p>
      <p v-if="rates.missing > 0" class="flex items-center gap-1">
        <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 text-warning" />
        {{ $t('rate.missingCount', rates.missing) }}
      </p>
    </div>

    <ShareBreakdownSheet
      v-if="opened"
      v-model:open="breakdownOpen"
      :participant="opened.participant"
      :breakdown="opened.breakdown"
      :currency="trip.currency"
      :paid="opened.balance.paid"
      :balance="opened.balance.rounded"
    />
  </NuxtLayout>
</template>
