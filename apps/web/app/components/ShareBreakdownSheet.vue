<script setup lang="ts">
import {
  compare,
  decimal,
  negate,
  roundMoney,
  shareOfSpending,
  type BreakdownPart,
  type Participant,
  type ParticipantBalance,
  type Rational,
  type ShareBreakdown,
} from '@osi/owe-yeah-domain';

// Where a Participant's share comes from, as a sheet headed by their avatar and name (and
// what it is of, e.g. the Receipt's title): each
// part of it (plain Expenses, goods, discounts, Deposits, Deposit refunds, what is not
// assigned yet, in amber with a line on why it is theirs for now, and Income), in the order the
// Receipt's summary uses, summed up in the share. The claimed Participant's title carries "you".
// Opened from a share on a Receipt; or, from their bar on the Balances tab, where the share is
// their Share of spending, also with what they paid towards Expenses, the Repayments they made
// and received (each only when not zero), and their balance, said as Balances says it ("Kasia
// owes €116.95", red; "is owed", green). The share there is what is left once that balance is
// taken from the rest, as the balance card shows it, so they all add up. Amounts stay exact and
// are only rounded to show them: the parts are shown rounded, a note says so when rounding
// changed any, and "≈" marks the share alone, when it is not exact itself. "≈" also marks every
// amount that includes one converted at a Provisional rate (a part, the share, what they paid,
// a Repayment total, the balance), and a note says the rate is provisional. Done closes it.
const {
  participant,
  breakdown,
  currency,
  claimId = null,
  context = null,
  balance = null,
} = defineProps<{
  participant: Participant;
  breakdown: ShareBreakdown;
  currency: string;
  claimId?: string | null;
  /** What the share is of, under the title, e.g. the Receipt's title. */
  context?: string | null;
  /** Their balance, on the Balances tab. */
  balance?: ParticipantBalance | null;
}>();
const open = defineModel<boolean>('open', { required: true });

const { t, locale } = useI18n();

// The order the parts show in, as the Receipt's summary reads: the goods after their Line
// discounts, then Deposit refunds, the Receipt discount and Deposits.
const ORDER = [
  'expenses',
  'goods',
  'lineDiscounts',
  'depositRefunds',
  'receiptDiscounts',
  'deposits',
  'unassigned',
  'income',
] as const satisfies readonly BreakdownPart[];
const place = (part: BreakdownPart) => ORDER.indexOf(part);

// An amount as rounded to show it, with "≈" only when it is `provisional`: the sheet marks
// rounding once, on the share.
const rounded = (amount: Rational, provisional = false) =>
  formatMoney(
    decimal(roundMoney(amount, currency).decimal),
    currency,
    locale.value,
    'currency',
    provisional,
  );

// "Kasia's balance" on the Balances tab, where it ends in it; "Kasia's share" on a Receipt.
const title = computed(() =>
  balance
    ? t('breakdown.balanceTitle', { name: participant.name })
    : t('breakdown.title', { name: participant.name }),
);

const sheet = computed(() => {
  const inexact = (amount: Rational) => !roundMoney(amount, currency).exact;
  // On the Balances tab, what they paid towards Expenses, then the Repayments not zero, labelled.
  const settling = balance
    ? [
        { label: t('breakdown.paid'), ...balance.paidForExpenses },
        ...[
          { label: t('breakdown.repaymentsMade'), ...balance.repaymentsMade },
          { label: t('breakdown.repaymentsReceived'), ...balance.repaymentsReceived },
        ].filter(({ amount }) => amount.numerator !== 0n),
      ]
    : [];
  // On the Balances tab, the share that adds up with those and their rounded balance.
  const share = balance ? shareOfSpending(balance).shown : breakdown.share;
  // Whether the share, and so the balance with the rest, include an amount converted at a
  // Provisional rate.
  const shareProvisional = breakdown.parts.some(({ provisional }) => provisional);
  const balanceProvisional = shareProvisional || settling.some(({ provisional }) => provisional);
  // Whether the share is not exactly what it shows.
  const roundedShare = compare(share, breakdown.share) !== 0 || inexact(share);
  const partsRounded =
    roundedShare ||
    settling.some(({ amount }) => inexact(amount)) ||
    breakdown.parts.some(({ amount }) => inexact(amount));
  return {
    parts: breakdown.parts
      .toSorted((a, b) => place(a.part) - place(b.part))
      .map(({ part, amount, provisional }) => ({
        label: t(`breakdown.part.${part}`),
        amount: rounded(amount, provisional),
        // What is not assigned yet, in amber as everywhere.
        tone: part === 'unassigned' ? 'text-warning' : '',
      })),
    unassigned: breakdown.parts.some(({ part }) => part === 'unassigned'),
    share: formatMoney(share, currency, locale.value, 'currency', shareProvisional || roundedShare),
    settling: settling.map(({ label, amount, provisional }) => ({
      label,
      amount: rounded(amount, provisional),
    })),
    partsRounded,
    provisional: balanceProvisional,
    outcome: balance && outcomeOf(balance.rounded, balanceProvisional),
  };
});

// Their balance as a sentence's start and an unsigned amount, toned as on the Balances tab,
// with "≈" when it is `provisional`.
function outcomeOf(rounded: Rational, provisional: boolean) {
  const sign = shownSign(rounded, currency);
  const you = participant.id === claimId;
  const name = participant.name;
  const amount = formatMoney(
    rounded.numerator < 0n ? negate(rounded) : rounded,
    currency,
    locale.value,
    'currency',
    provisional,
  );
  if (sign < 0) {
    return {
      label: you ? t('balances.owe') : t('breakdown.owes', { name }),
      amount,
      tone: 'text-error',
    };
  }
  if (sign > 0) {
    return {
      label: you ? t('balances.owed') : t('breakdown.isOwed', { name }),
      amount,
      tone: 'text-success',
    };
  }
  return {
    label: you ? t('balances.even') : t('breakdown.isEven', { name }),
    amount,
    tone: 'text-muted',
  };
}
</script>

<template>
  <UDrawer v-model:open="open" :title="title" :description="context ?? undefined">
    <template #title>
      <span class="flex items-center gap-3">
        <ParticipantAvatar :participant="participant" size="md" />
        {{ title }}
        <YouBadge v-if="participant.id === claimId" />
      </span>
    </template>
    <template #body>
      <dl class="tabular-nums">
        <div
          v-for="{ label, amount, tone } in sheet.parts"
          :key="label"
          class="flex justify-between gap-6 py-1.5"
          :class="tone"
        >
          <dt>{{ label }}</dt>
          <dd class="shrink-0">{{ amount }}</dd>
        </div>
        <div
          class="mt-1 flex justify-between gap-3 border-t border-default pt-2.5 pb-1.5 font-semibold text-highlighted"
        >
          <dt>{{ $t('breakdown.share') }}</dt>
          <dd class="shrink-0">{{ sheet.share }}</dd>
        </div>
        <template v-if="sheet.outcome">
          <div
            v-for="({ label, amount }, index) in sheet.settling"
            :key="label"
            class="flex justify-between gap-3 py-1.5"
            :class="{ 'mt-3': index === 0 }"
          >
            <dt>{{ label }}</dt>
            <dd class="shrink-0">{{ amount }}</dd>
          </div>
          <div
            class="mt-1 flex justify-between gap-3 border-t border-default pt-2.5 pb-1.5 font-semibold"
          >
            <dt class="text-highlighted">{{ sheet.outcome.label }}</dt>
            <dd class="shrink-0" :class="sheet.outcome.tone">{{ sheet.outcome.amount }}</dd>
          </div>
        </template>
      </dl>
      <p v-if="sheet.unassigned" class="mt-3 text-sm text-muted">
        {{
          participant.id === claimId
            ? $t('breakdown.unassignedRuleYours')
            : $t('breakdown.unassignedRule')
        }}
      </p>
      <p v-if="sheet.partsRounded" class="mt-2 text-sm text-muted">
        {{ $t('breakdown.roundedParts') }}
      </p>
      <p v-if="sheet.provisional" class="mt-2 text-sm text-muted">
        {{ $t('breakdown.provisional') }}
      </p>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        block
        size="xl"
        :label="$t('form.done')"
        @click="open = false"
      />
    </template>
  </UDrawer>
</template>
