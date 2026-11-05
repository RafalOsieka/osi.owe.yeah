<script setup lang="ts">
import {
  claimView,
  expenseKind,
  expenseRate,
  expenseShares,
  groupByLocalDay,
  rateSummary,
  spendingTotal,
  type Rational,
} from '@osi/owe-yeah-domain';
import type { LocalExpense, LocalTrip } from '~/sync/local-trip';

// The Trip's Expenses, newest first, under a heading for each Expense's own local day with
// what was spent that day in the Trip currency (net of Income, without Repayments; "≈" when an
// Expense of the day uses a Provisional rate). Each row shows the Expense in its own currency,
// with its payer's avatar (a Repayment, which is not spending, a quiet arrow instead), opens its
// detail page and, with a Claim, says what the Expense means for the claimed
// Participant. A row is marked while it is not synced, or in Conflict, and when its rate is a
// Provisional rate or it has none yet. A Receipt reads "Receipt · N items", marked with how
// many Line items are not fully assigned yet. The Expense `highlightId` names, e.g. the one a
// tapped notification was about, is scrolled to and marked.
const {
  trip,
  claimId = null,
  highlightId = null,
} = defineProps<{
  trip: LocalTrip;
  claimId?: string | null;
  highlightId?: string | null;
}>();

const { t, locale } = useI18n();

const participants = computed(() => new Map(trip.participants.map((p) => [p.id, p])));

const money = (amount: Rational, currency: string) => formatMoney(amount, currency, locale.value);

// What the claimed Participant sees on the right of a row, under the total: what they lent
// or get back in green, and their share, or money that only changed hands (a Repayment, an
// Income they received), in neutral: a share is not a debt, so red is left to owing.
function forYou(expense: LocalExpense): { text: string; tone: string } | null {
  if (claimId === null) return null;
  const view = claimView(expense, claimId);
  const amount = view.kind === 'notForYou' ? '' : money(view.amount, expense.currency);
  switch (view.kind) {
    case 'lent':
      return { text: t('expense.youLent', { amount }), tone: 'text-success' };
    case 'share':
      return { text: t('expense.yourShare', { amount }), tone: 'text-muted' };
    case 'received':
      return { text: t('expense.youReceived', { amount }), tone: 'text-muted' };
    case 'getBack':
      return { text: t('expense.youGetBack', { amount }), tone: 'text-success' };
    case 'repaid':
      return { text: t('expense.youRepaid', { amount }), tone: 'text-muted' };
    case 'notForYou':
      return { text: t('expense.notForYou'), tone: 'text-muted' };
  }
}

// A row's summary by the Expense's kind, e.g. "Kasia paid · for all 4" or "Receipt · 6 items".
function summaryOf(expense: LocalExpense, payer: string, forWhom: string, items: number): string {
  const kinded = expenseKind(expense);
  switch (kinded.kind) {
    case 'receipt':
      return t('receipt.summary', items);
    case 'repayment': {
      const recipient = participants.value.get(kinded.expense.recipientId)?.name ?? '?';
      return t('repayment.fromTo', { payer, recipient });
    }
    case 'income':
      return t('expense.receivedFor', { name: payer, forWhom });
    case 'plain':
      return t('expense.paidFor', { name: payer, forWhom });
  }
}

const days = computed(() =>
  groupByLocalDay(trip.expenses).map(({ day, expenses }) => {
    const rows = expenses.map((expense) => {
      const { total, shares, lineItems } = expenseShares(expense);
      const count = shares.size;
      const payer = participants.value.get(expense.mainPayerId)?.name ?? '?';
      const forWhom =
        count === trip.participants.length
          ? t('expense.forAll', { count })
          : t('expense.forSome', { count });
      return {
        expense,
        total,
        payer: participants.value.get(expense.mainPayerId),
        repayment: expenseKind(expense).kind === 'repayment',
        summary: summaryOf(expense, payer, forWhom, lineItems.length),
        unassigned: lineItems.filter(({ unassigned }) => unassigned.numerator !== 0n).length,
        rate: expenseRate(expense, trip),
        forYou: forYou(expense),
      };
    });
    const ofDay = { ...trip, expenses };
    const total = spendingTotal(ofDay);
    const approximate = rateSummary(ofDay).provisional > 0;
    return {
      day,
      total: formatMoney(total, trip.currency, locale.value, 'currency', approximate),
      rows,
    };
  }),
);

const rowId = (expenseId: string) => `expense-${expenseId}`;
// Also when a notification is tapped while the list is open already.
watch(
  () => highlightId,
  (id) => id && document.getElementById(rowId(id))?.scrollIntoView({ block: 'center' }),
  { immediate: true, flush: 'post' },
);

// A local day (`YYYY-MM-DD`) in words, e.g. "Sunday, July 5", with the year only when it isn't
// this one. It is a calendar date, not an instant, so it is formatted in UTC to keep the
// device's zone from shifting it.
function dayHeading(day: string): string {
  const thisYear = day.startsWith(String(new Date().getFullYear()));
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: thisYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
</script>

<template>
  <div class="space-y-6">
    <section v-for="{ day, total, rows } in days" :key="day">
      <div class="section-heading flex items-baseline justify-between gap-2">
        <h3 class="min-w-0 truncate">{{ dayHeading(day) }}</h3>
        <span class="shrink-0 font-medium tabular-nums">{{ total }}</span>
      </div>
      <ul class="card overflow-hidden">
        <li
          v-for="row in rows"
          :id="rowId(row.expense.id)"
          :key="row.expense.id"
          class="relative after:absolute after:start-[4.25rem] after:end-0 after:bottom-0 after:h-px after:bg-(--ui-border) last:after:hidden"
          :class="{ 'bg-primary/8': row.expense.id === highlightId }"
        >
          <NuxtLink
            :to="`/trips/${trip.id}/expenses/${row.expense.id}`"
            class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/60 active:bg-elevated"
          >
            <span
              v-if="row.repayment"
              class="grid size-10 shrink-0 place-items-center rounded-full bg-elevated text-muted"
            >
              <UIcon name="i-lucide-arrow-right-left" class="size-5" />
            </span>
            <ParticipantAvatar v-else-if="row.payer" :participant="row.payer" size="lg" />
            <span class="min-w-0 flex-1">
              <span class="line-clamp-2 font-medium text-highlighted wrap-anywhere">
                {{ row.expense.title }}
              </span>
              <span class="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted">
                <UBadge
                  v-if="row.expense.unsynced?.status === 'conflict'"
                  :label="$t('sync.conflictBadge')"
                  color="error"
                  variant="soft"
                  size="sm"
                  class="shrink-0"
                />
                <UBadge
                  v-else-if="row.expense.unsynced"
                  :label="$t('sync.notSynced')"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  class="shrink-0"
                />
                <UBadge
                  v-if="row.rate === null"
                  :label="$t('rate.missingBadge')"
                  color="warning"
                  variant="soft"
                  size="sm"
                  class="shrink-0"
                />
                <UBadge
                  v-else-if="row.rate.provisional"
                  :label="$t('rate.provisionalBadge')"
                  color="warning"
                  variant="soft"
                  size="sm"
                  class="shrink-0"
                />
                <UBadge
                  v-if="row.unassigned > 0"
                  :label="$t('receipt.unassignedBadge', row.unassigned)"
                  color="warning"
                  variant="soft"
                  size="sm"
                  class="shrink-0"
                />
                <span class="truncate">{{ row.summary }}</span>
              </span>
            </span>
            <span class="shrink-0 text-end tabular-nums">
              <span
                class="block font-semibold"
                :class="row.repayment ? 'text-muted' : 'text-highlighted'"
              >
                {{ money(row.total, row.expense.currency) }}
              </span>
              <span v-if="row.forYou" class="mt-0.5 block text-sm" :class="row.forYou.tone">
                {{ row.forYou.text }}
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
