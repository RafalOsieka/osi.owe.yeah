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

// The Balances tab: your balance, with your own Suggested Repayments ("To settle") on its
// card, then everyone's balance as diverging bars, headed by what the Trip spent, the other
// Suggested Repayments (all of them without a Claim), and Record another Repayment. Once the
// Trip is Settled, "All settled" replaces the balance and the suggestions. Balances are worked out exactly and
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
const { t, locale } = useI18n();
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

// The claimed Participant's debtors, Remind on their suggestions: how it reminds each, and the
// line saying beforehand when it passes on a message instead of notifying them.
const remindable = computed(
  () =>
    new Map(
      suggestions.value.own
        .filter(({ recipientId }) => recipientId === claim.value?.id)
        .map(({ payerId }) => {
          const by = reminders.by(payerId);
          const hints = { share: t('reminder.byShare'), copy: t('reminder.byCopy') };
          const hint = by === 'share' || by === 'copy' ? hints[by] : null;
          const debtor = trip.value.participants.find(({ id }) => id === payerId)?.name ?? '?';
          return [payerId, { by, hint, debtor }];
        }),
    ),
);
</script>

<template>
  <NuxtLayout name="trip">
    <section v-if="settled" class="card flex items-center gap-4 p-5">
      <span
        class="grid size-12 shrink-0 place-items-center rounded-full bg-success/12 text-success"
      >
        <UIcon name="i-lucide-check" class="size-6" />
      </span>
      <div>
        <h2 class="text-xl font-semibold tracking-tight text-highlighted">
          {{ $t('balances.allSettled') }}
        </h2>
        <p class="text-sm text-muted">{{ $t('balances.allSettledHelp') }}</p>
      </div>
    </section>
    <template v-else>
      <BalanceCard :balance="mine" :total="total" :currency="trip.currency">
        <template v-if="suggestions.own.length > 0" #default>
          <section aria-labelledby="to-settle-heading" class="pt-3">
            <h2 id="to-settle-heading" class="px-5 text-xs font-medium text-muted">
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
                  v-if="remindable.get(suggestion.payerId)?.hint"
                  class="block text-xs text-muted"
                >
                  {{ remindable.get(suggestion.payerId)?.hint }}
                </span>
              </template>
              <template #action="{ suggestion }">
                <RemindButton
                  v-if="remindable.has(suggestion.payerId)"
                  :by="remindable.get(suggestion.payerId)!.by"
                  :debtor="remindable.get(suggestion.payerId)!.debtor"
                  :sending="reminders.sending.value === suggestion.payerId"
                  @remind="reminders.remind(suggestion)"
                />
              </template>
            </SuggestedRepaymentList>
          </section>
        </template>
      </BalanceCard>
    </template>

    <section aria-labelledby="everyone-heading">
      <div class="section-heading mt-7 flex items-baseline justify-between gap-2">
        <h2 id="everyone-heading">{{ $t('balances.everyone') }}</h2>
        <p class="font-normal tabular-nums">
          {{
            $t('balances.tripTotalIs', {
              amount: formatMoney(total, trip.currency, locale, 'currency', rates.provisional > 0),
            })
          }}
        </p>
      </div>
      <BalanceBars
        :balances="everyone"
        :participants="trip.participants"
        :currency="trip.currency"
        :claim-id="claim?.id"
        @select="openBreakdown"
      />
    </section>

    <section v-if="!settled && suggestions.others.length > 0" aria-labelledby="suggestions-heading">
      <h2 id="suggestions-heading" class="section-heading mt-7">
        {{ claim ? $t('balances.otherSuggestions') : $t('balances.suggestions') }}
      </h2>
      <SuggestedRepaymentList
        class="card overflow-hidden"
        :suggestions="suggestions.others"
        :participants="trip.participants"
        :trip-id="trip.id"
        :currency="trip.currency"
        :claim-id="claim?.id"
        :highlight="highlight"
      />
    </section>

    <NuxtLink
      :to="`/trips/${trip.id}/repayments/new`"
      class="card mt-6 flex items-center gap-3 px-4 py-3 font-medium text-primary transition-colors hover:bg-elevated/60"
    >
      <span class="grid size-8 place-items-center rounded-full bg-primary/10">
        <UIcon name="i-lucide-plus" class="size-4" />
      </span>
      {{ $t('balances.recordAnother') }}
    </NuxtLink>

    <div
      v-if="rates.provisional > 0 || rates.missing > 0"
      class="mt-5 space-y-1 px-1 text-sm text-muted"
    >
      <p v-if="rates.provisional > 0" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 text-warning" />
        {{ $t('rate.provisionalCount', rates.provisional) }}
      </p>
      <p v-if="rates.missing > 0" class="flex items-center gap-1.5">
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
