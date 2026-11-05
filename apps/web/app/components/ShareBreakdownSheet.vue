<script setup lang="ts">
import {
  compare,
  decimal,
  negate,
  roundMoney,
  subtract,
  type Participant,
  type Rational,
  type ShareBreakdown,
} from '@osi/owe-yeah-domain';

// Where a Participant's share comes from, as a sheet headed by their avatar and name (and
// what it is of, e.g. the Receipt's title): each
// part of it (plain Expenses, goods, discounts, Deposits, Deposit refunds, what is not
// assigned yet, Income and Repayments received), summed up in the share. Opened from a share
// on a Receipt; or, from their bar on the Balances tab, also with what they paid and their
// balance, said as Balances says it ("Kasia owes €116.95", red; "is owed", green), the share
// there being what they paid less that balance, as the balance card shows it, so the three add
// up. Amounts stay exact and are only rounded to show them: the parts are shown rounded, a
// note says so when rounding changed any, and "≈" marks the share alone, when it is not exact
// itself. Done closes it.
const {
  participant,
  breakdown,
  currency,
  claimId = null,
  context = null,
  paid = null,
  balance = null,
} = defineProps<{
  participant: Participant;
  breakdown: ShareBreakdown;
  currency: string;
  claimId?: string | null;
  /** What the share is of, under the title, e.g. the Receipt's title. */
  context?: string | null;
  /** What they paid, on the Balances tab. */
  paid?: Rational | null;
  /** Their rounded balance, as their bar shows it, on the Balances tab. */
  balance?: Rational | null;
}>();
const open = defineModel<boolean>('open', { required: true });

const { t, locale } = useI18n();

// An amount as rounded to show it, without "≈": the sheet marks rounding once, on the share.
const rounded = (amount: Rational) =>
  formatMoney(decimal(roundMoney(amount, currency).decimal), currency, locale.value);

const sheet = computed(() => {
  const inexact = (amount: Rational) => !roundMoney(amount, currency).exact;
  // On the Balances tab, the share that adds up with what they paid and their balance.
  const share = paid && balance ? subtract(paid, balance) : breakdown.share;
  // "≈" on the share only when it is not exactly what it shows.
  const approximate = compare(share, breakdown.share) !== 0 || inexact(share);
  const partsRounded =
    approximate ||
    (paid !== null && inexact(paid)) ||
    breakdown.parts.some(({ amount }) => inexact(amount));
  return {
    parts: breakdown.parts.map(({ part, amount }) => ({
      label: t(`breakdown.part.${part}`),
      amount: rounded(amount),
    })),
    share: formatMoney(share, currency, locale.value, 'currency', approximate),
    partsRounded,
    outcome: balance && outcomeOf(balance),
  };
});

// Their balance as a sentence's start and an unsigned amount, toned as on the Balances tab.
function outcomeOf(rounded: Rational) {
  const sign = shownSign(rounded, currency);
  const you = participant.id === claimId;
  const name = participant.name;
  const amount = formatMoney(
    rounded.numerator < 0n ? negate(rounded) : rounded,
    currency,
    locale.value,
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
  <UDrawer
    v-model:open="open"
    :title="$t('breakdown.title', { name: participant.name })"
    :description="context ?? undefined"
  >
    <template #title>
      <span class="flex items-center gap-3">
        <ParticipantAvatar :participant="participant" size="md" />
        {{ $t('breakdown.title', { name: participant.name }) }}
      </span>
    </template>
    <template #body>
      <dl class="tabular-nums">
        <div
          v-for="{ label, amount } in sheet.parts"
          :key="label"
          class="flex justify-between gap-3 py-1.5"
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
        <template v-if="paid && sheet.outcome">
          <div class="mt-3 flex justify-between gap-3 py-1.5">
            <dt>{{ $t('breakdown.paid') }}</dt>
            <dd class="shrink-0">{{ rounded(paid) }}</dd>
          </div>
          <div
            class="mt-1 flex justify-between gap-3 border-t border-default pt-2.5 pb-1.5 font-semibold"
          >
            <dt class="text-highlighted">{{ sheet.outcome.label }}</dt>
            <dd class="shrink-0" :class="sheet.outcome.tone">{{ sheet.outcome.amount }}</dd>
          </div>
        </template>
      </dl>
      <p v-if="sheet.partsRounded" class="mt-3 text-sm text-muted">
        {{ $t('breakdown.roundedParts') }}
      </p>
    </template>
    <template #footer>
      <UButton
        block
        color="neutral"
        variant="soft"
        :label="$t('breakdown.done')"
        @click="open = false"
      />
    </template>
  </UDrawer>
</template>
