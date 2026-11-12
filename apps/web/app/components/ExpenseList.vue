<script setup lang="ts">
import {
  absolute,
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
// what was spent that day in the Trip currency ("spent €54.00": net of Income, without
// Repayments; "≈" when an Expense of the day uses a Provisional rate). Each row shows the
// Expense in its own currency (Income as the money received, without a minus), with its
// payer's avatar (a Repayment, which is not spending, a quiet arrow instead), opens its detail
// page and, with a Claim, says what the Expense means for the claimed Participant. The title
// is cut short if need be; the second line says who paid and for how many, after a small
// receipt glyph on a Receipt and a short amber flag (a Conflict, a Provisional rate or none
// yet); Line items not fully assigned yet get a third, amber line of their own ("1 item
// unassigned"), so the payer stays in sight. A cloud with an amber dot by the amount, as in
// the header, marks a row not synced yet. The Expense `highlightId` names, e.g. the one a
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

// What the claimed Participant sees on the right of a row, under the total (`claimView`): what
// they lent or get back in green; their share, or money received that is all theirs (a
// Repayment), in neutral, as a share is not a debt; and the others' part of money they received
// for them too, which they now owe, in red, as Balances says it.
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
    case 'owe':
      return { text: t('expense.youOwe', { amount }), tone: 'text-error' };
    case 'getBack':
      return { text: t('expense.youGetBack', { amount }), tone: 'text-success' };
    case 'repaid':
      return { text: t('expense.youRepaid', { amount }), tone: 'text-muted' };
    case 'notForYou':
      return { text: t('expense.notForYou'), tone: 'text-muted' };
  }
}

// What needs attention about a row, leading its second line in amber: a Conflict to resolve,
// or no rate yet, or only a Provisional one.
function flagOf(expense: LocalExpense): string | null {
  if (expense.unsynced?.status === 'conflict') return t('sync.conflictBadge');
  const rate = expenseRate(expense, trip);
  if (rate === null) return t('rate.missingBadge');
  return rate.provisional ? t('rate.provisionalBadge') : null;
}

// A row's summary by the Expense's kind, e.g. "Kasia paid · for all 4" or "Kasia → Marta".
function summaryOf(expense: LocalExpense, payer: string, forWhom: string): string {
  const kinded = expenseKind(expense);
  switch (kinded.kind) {
    case 'repayment': {
      const recipient = participants.value.get(kinded.expense.recipientId)?.name ?? '?';
      return t('repayment.fromTo', { payer, recipient });
    }
    case 'income':
      return t('expense.receivedFor', { name: payer, forWhom });
    case 'plain':
    case 'receipt':
      return t('expense.paidFor', { name: payer, forWhom });
  }
}

const days = computed(() =>
  groupByLocalDay(trip.expenses).map(({ day, expenses }) => {
    const rows = expenses.map((expense) => {
      const { total, shares, lineItems } = expenseShares(expense);
      const count = shares.size;
      const unassigned = lineItems.filter(({ unassigned }) => unassigned.numerator !== 0n).length;
      const payer = participants.value.get(expense.mainPayerId)?.name ?? '?';
      const forWhom =
        count === trip.participants.length
          ? t('expense.forAll', { count })
          : t('expense.forSome', { count });
      return {
        expense,
        // Income as the money received.
        total: absolute(total),
        payer: participants.value.get(expense.mainPayerId),
        repayment: expenseKind(expense).kind === 'repayment',
        receipt: expenseKind(expense).kind === 'receipt',
        summary: summaryOf(expense, payer, forWhom),
        unassigned,
        flag: flagOf(expense),
        notSynced: !!expense.unsynced && expense.unsynced.status !== 'conflict',
        forYou: forYou(expense),
      };
    });
    const ofDay = { ...trip, expenses };
    const total = spendingTotal(ofDay);
    const approximate = rateSummary(ofDay).provisional > 0;
    return {
      day,
      total: t('expense.daySpent', {
        amount: formatMoney(total, trip.currency, locale.value, 'currency', approximate),
      }),
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
              class="grid size-9 shrink-0 place-items-center rounded-full bg-elevated text-muted"
            >
              <UIcon name="i-lucide-arrow-right-left" class="size-4.5" />
            </span>
            <ParticipantAvatar v-else-if="row.payer" :participant="row.payer" size="lg" />
            <!-- Two lanes: the title against the amount, the summary against what it means
                 for you, so neither line squeezes the other. -->
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline gap-3">
                <span class="min-w-0 flex-1 truncate font-medium text-highlighted">
                  {{ row.expense.title }}
                </span>
                <span
                  class="flex shrink-0 items-center gap-1.5 self-center font-semibold tabular-nums"
                  :class="row.repayment ? 'text-muted' : 'text-highlighted'"
                >
                  <!-- The header's not-synced cloud, in small. -->
                  <span v-if="row.notSynced" class="relative shrink-0">
                    <UIcon
                      name="i-lucide-cloud"
                      class="block size-4 text-muted"
                      aria-hidden="true"
                    />
                    <span
                      class="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-warning"
                      aria-hidden="true"
                    />
                    <span class="sr-only">{{ $t('sync.notSynced') }}</span>
                  </span>
                  {{ money(row.total, row.expense.currency) }}
                </span>
              </span>
              <span class="mt-0.5 flex items-baseline gap-3 text-sm">
                <!-- The parts, joined by " · " -->
                <span
                  class="min-w-0 flex-1 truncate text-muted [&>span+span]:before:mx-1 [&>span+span]:before:font-normal [&>span+span]:before:text-muted [&>span+span]:before:content-['·']"
                >
                  <!-- Not a span, so no " · " follows it. -->
                  <i v-if="row.receipt" class="me-1 not-italic">
                    <UIcon
                      name="i-lucide-receipt-text"
                      class="inline-block size-3.5 align-[-0.125em]"
                      role="img"
                      :aria-label="$t('receipt.kind')"
                    />
                  </i>
                  <span v-if="row.flag" class="font-medium text-warning">{{ row.flag }}</span>
                  <span>{{ row.summary }}</span>
                </span>
                <span v-if="row.forYou" class="shrink-0 tabular-nums" :class="row.forYou.tone">
                  {{ row.forYou.text }}
                </span>
              </span>
              <span
                v-if="row.unassigned > 0"
                class="mt-0.5 flex items-center gap-1 text-sm font-medium text-warning"
              >
                <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" aria-hidden="true" />
                {{ $t('receipt.unassignedBadge', row.unassigned) }}
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
