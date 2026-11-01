<script setup lang="ts">
import {
  claimView,
  expenseShares,
  groupByLocalDay,
  isRepayment,
  spendingTotal,
  type Rational,
} from '@osi/owe-yeah-domain';
import type { LocalExpense, LocalTrip } from '~/sync/local-trip';

// The Trip's Expenses, newest first, under a heading for each Expense's own local day with
// what was spent that day (net of Income, without Repayments). Each row opens the Expense's detail page and, with a Claim, says what
// the Expense means for the claimed Participant, and marks it while it is not synced, or in
// Conflict.
const { trip, claimId = null } = defineProps<{
  trip: LocalTrip;
  claimId?: string | null;
}>();

const { t, locale } = useI18n();

const participants = computed(() => new Map(trip.participants.map((p) => [p.id, p])));

const money = (amount: Rational) => formatMoney(amount, trip.currency, locale.value);
const bare = (amount: Rational) => formatMoney(amount, trip.currency, locale.value, 'number');

// What the claimed Participant sees on the right of a row, under the total: what they lent
// or get back in green, their share in red, and money that only changed hands (a Repayment,
// an Income they received) in neutral, as it is not spending.
function forYou(expense: LocalExpense): { text: string; tone: string } | null {
  if (claimId === null) return null;
  const view = claimView(expense, claimId);
  switch (view.kind) {
    case 'lent':
      return { text: t('expense.youLent', { amount: bare(view.amount) }), tone: 'text-primary' };
    case 'share':
      return { text: t('expense.yourShare', { amount: bare(view.amount) }), tone: 'text-error' };
    case 'received':
      return { text: t('expense.youReceived', { amount: bare(view.amount) }), tone: 'text-muted' };
    case 'getBack':
      return { text: t('expense.youGetBack', { amount: bare(view.amount) }), tone: 'text-primary' };
    case 'repaid':
      return { text: t('expense.youRepaid', { amount: bare(view.amount) }), tone: 'text-muted' };
    case 'notForYou':
      return { text: t('expense.notForYou'), tone: 'text-muted' };
  }
}

const days = computed(() =>
  groupByLocalDay(trip.expenses).map(({ day, expenses }) => {
    const rows = expenses.map((expense) => {
      const { total, shares } = expenseShares(expense);
      const count = shares.size;
      const payer = participants.value.get(expense.mainPayerId)?.name ?? '?';
      const forWhom =
        count === trip.participants.length
          ? t('expense.forAll', { count })
          : t('expense.forSome', { count });
      let summary: string;
      if (isRepayment(expense)) {
        const recipient = participants.value.get(expense.recipientId)?.name ?? '?';
        summary = t('repayment.fromTo', { payer, recipient });
      } else if (total.numerator < 0n) {
        summary = t('expense.receivedFor', { name: payer, forWhom });
      } else {
        summary = t('expense.paidFor', { name: payer, forWhom });
      }
      return {
        expense,
        total,
        payer: participants.value.get(expense.mainPayerId),
        summary,
        forYou: forYou(expense),
      };
    });
    return { day, total: spendingTotal(expenses), rows };
  }),
);

// A local day (`YYYY-MM-DD`) in words. It is a calendar date, not an instant, so it is
// formatted in UTC to keep the device's zone from shifting it.
function dayHeading(day: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}
</script>

<template>
  <div>
    <section v-for="{ day, total, rows } in days" :key="day" class="mb-2">
      <div
        class="mt-3 mb-1 flex justify-between gap-2 text-xs font-semibold tracking-wide text-muted"
      >
        <h3 class="min-w-0 truncate uppercase">{{ dayHeading(day) }}</h3>
        <span class="shrink-0 font-medium tabular-nums">{{ money(total) }}</span>
      </div>
      <ul>
        <li
          v-for="row in rows"
          :key="row.expense.id"
          class="border-b border-default last:border-b-0"
        >
          <NuxtLink
            :to="`/trips/${trip.id}/expenses/${row.expense.id}`"
            class="flex items-center gap-2.5 py-2.5"
          >
            <ParticipantAvatar v-if="row.payer" :participant="row.payer" size="md" />
            <span class="min-w-0 flex-1 leading-snug">
              <span class="block truncate font-semibold">{{ row.expense.title }}</span>
              <span class="block truncate text-xs text-muted">
                <UBadge
                  v-if="row.expense.unsynced?.status === 'conflict'"
                  :label="$t('sync.conflictBadge')"
                  color="error"
                  variant="subtle"
                  size="sm"
                  class="me-1"
                />
                <UBadge
                  v-else-if="row.expense.unsynced"
                  :label="$t('sync.notSynced')"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  class="me-1"
                />
                {{ row.summary }}
              </span>
            </span>
            <span class="shrink-0 text-right leading-snug tabular-nums">
              <span class="block font-semibold">{{ money(row.total) }}</span>
              <span v-if="row.forYou" class="block text-xs" :class="row.forYou.tone">
                {{ row.forYou.text }}
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
