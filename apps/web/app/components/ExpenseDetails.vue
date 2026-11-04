<script setup lang="ts">
import {
  expenseKind,
  expenseRate,
  expenseShares,
  fromMinor,
  isDepositRefund,
  decimal,
  multiply,
  roundMoney,
  shareBreakdown,
  type Discount,
  type Expense,
  type Rational,
} from '@osi/owe-yeah-domain';

// An Expense in full, as its detail page and an old Revision show it: the full title, total,
// when it was paid in its own zone, the Main payer (who received it, for Income) with their
// part, then each Contribution from others, and each Participant's share, the claimed
// Participant's in bold. A Repayment shows who paid whom. A Receipt also lists its Line items,
// with how each is split, its Line discount, its Deposit, and what is not assigned yet,
// Deposit refunds as negative lines, and then its Receipt discount and its Deposits total.
// On a Receipt, tapping a share opens where it comes from (`ShareBreakdownSheet`). Shares are
// rounded only to show them, so a note explains "≈" when they don't add up to the total. All
// amounts are in the Expense's own currency; `converted` adds its total in the Trip currency
// under it, at the rate for its local date, "≈" and explained at a Provisional rate, or says
// it is left out of balances while there is no rate yet. A Manual rate shows as it was typed.
const { expense, converted = false } = defineProps<{
  expense: Expense;
  /** Show the total converted into the Trip currency, as the Expense is now. */
  converted?: boolean;
}>();

const { trip, claim, everyone } = useOpenTrip();
const { t, locale } = useI18n();
const splitText = useSplitText();

const money = (amount: Rational) => formatMoney(amount, expense.currency, locale.value);

const kinded = computed(() => expenseKind(expense));

const details = computed(() => {
  const { total, discountOff, deposits, paid, shares, unassigned, lineItems } =
    expenseShares(expense);
  const { kind, expense: narrowed } = kinded.value;
  const receipt = kind === 'receipt' ? narrowed : null;
  const discountText = (entered: Discount | undefined, off: Rational) =>
    entered && formatDiscount(entered, off, expense.currency, locale.value);
  return {
    total,
    unassigned: unassigned.numerator === 0n ? null : unassigned,
    discount: receipt ? discountText(receipt.discount, discountOff) : undefined,
    deposits: deposits.numerator === 0n ? null : deposits,
    lineItems: receipt
      ? receipt.lineItems.map((item, index) => ({
          discountText: discountText(item.discount, lineItems[index]!.discountOff),
          name:
            item.name ||
            (isDepositRefund(item)
              ? t('receipt.depositRefund')
              : t('receipt.unnamed', { position: index + 1 })),
          quantity: item.quantity,
          unitPrice: formatMoney(
            fromMinor(item.unitPrice, expense.currency),
            expense.currency,
            locale.value,
            'number',
          ),
          split: splitText(item.split, everyone.value),
          ...lineItems[index]!,
        }))
      : null,
    repayment: kind === 'repayment',
    income: kind === 'income',
    when: formatExpenseTime(expense.time, locale.value),
    payer: everyone.value.find(({ id }) => id === expense.mainPayerId),
    // The Main payer first, then the Contributions in the order they were added.
    payers: [...paid].flatMap(([id, amount]) => {
      const participant = everyone.value.find((other) => other.id === id);
      return participant ? [{ participant, amount, contribution: id !== expense.mainPayerId }] : [];
    }),
    // In the Trip's order.
    shares: everyone.value.flatMap((participant) => {
      const share = shares.get(participant.id);
      return share ? [{ participant, share }] : [];
    }),
    rounded: [...shares.values()].some((share) => !roundMoney(share, expense.currency).exact),
  };
});

// The total in the Trip currency, when the Expense is in another one.
const conversion = computed(() => {
  const { currency } = trip.value;
  if (!converted || expense.currency === currency) return null;
  const found = expenseRate(expense, trip.value);
  const manual = manualRateText();
  if (!found) {
    return {
      text: t('rate.noRate'),
      manual,
      help: t('rate.missingHelp', { from: expense.currency }),
    };
  }
  const total = multiply(details.value.total, found.rate);
  return {
    manual,
    text: t('rate.converted', {
      amount: formatMoney(total, currency, locale.value, 'currency', found.provisional),
      from: expense.currency,
      rate: formatRate(found.rate, locale.value),
      to: currency,
    }),
    help: found.provisional ? t('rate.provisionalHelp', { currency }) : null,
  };
});

// The Manual rate as typed, e.g. "Manual rate: 1 USD = 4.05 PLN" or "Manual rate: zł45.00
// charged"; `null` without one.
function manualRateText(): string | null {
  const { manualRate } = expense;
  if (!manualRate) return null;
  if (manualRate.kind === 'rate') {
    return t('rate.manualTypedRate', {
      from: expense.currency,
      rate: formatRate(decimal(manualRate.rate), locale.value),
      to: manualRate.currency,
    });
  }
  return t('rate.manualTypedCharged', {
    amount: formatMoney(
      fromMinor(manualRate.amount, manualRate.currency),
      manualRate.currency,
      locale.value,
    ),
  });
}

// Every share's breakdown, on a Receipt; the open sheet shows the one tapped.
const breakdowns = computed(() =>
  kinded.value.kind === 'receipt' ? shareBreakdown(kinded.value.expense) : null,
);
const breakdownOpen = ref(false);
const breakdownOf = ref<string | null>(null);
const opened = computed(() => {
  const participant = everyone.value.find(({ id }) => id === breakdownOf.value);
  const breakdown = breakdowns.value?.get(breakdownOf.value ?? '');
  return participant && breakdown ? { participant, breakdown } : null;
});
useCloseOnBack(breakdownOpen);

function openBreakdown(participantId: string): void {
  breakdownOf.value = participantId;
  breakdownOpen.value = true;
}
</script>

<template>
  <div>
    <p class="text-xl leading-tight font-bold wrap-anywhere">{{ expense.title }}</p>
    <p class="mt-0.5 text-3xl font-bold tabular-nums">{{ money(details.total) }}</p>
    <template v-if="conversion">
      <p class="font-medium tabular-nums">{{ conversion.text }}</p>
      <p v-if="conversion.manual" class="text-sm text-muted tabular-nums">
        {{ conversion.manual }}
      </p>
      <p v-if="conversion.help" class="text-xs text-warning">{{ conversion.help }}</p>
    </template>
    <p class="text-sm text-muted">
      {{ $t('expense.timeInZone', { time: details.when, zone: expense.time.zone }) }}
    </p>

    <section aria-labelledby="paid-by-heading">
      <h2 id="paid-by-heading" class="mt-5 mb-1 text-xs font-semibold text-muted uppercase">
        {{ details.income ? $t('expense.receivedBy') : $t('expense.paidBy') }}
      </h2>
      <ul>
        <li
          v-for="{ participant, amount, contribution } in details.payers"
          :key="participant.id"
          class="flex items-center gap-2.5 py-1.5"
        >
          <ParticipantAvatar :participant="participant" />
          <span class="min-w-0 flex-1 leading-snug">
            <span class="block truncate">{{ participant.name }}</span>
            <span v-if="contribution" class="block text-xs text-muted">
              {{ $t('contribution.label') }}
            </span>
          </span>
          <span class="shrink-0 tabular-nums">{{ money(amount) }}</span>
        </li>
      </ul>
    </section>

    <section v-if="details.lineItems" aria-labelledby="line-items-heading">
      <h2 id="line-items-heading" class="mt-5 mb-1 text-xs font-semibold text-muted uppercase">
        {{ $t('receipt.lineItems') }}
      </h2>
      <ol>
        <li
          v-for="(line, index) in details.lineItems"
          :key="index"
          class="flex items-start gap-2 border-b border-default py-1.5 last:border-b-0"
        >
          <span class="min-w-0 flex-1 leading-snug">
            <span class="block wrap-anywhere">{{ line.name }}</span>
            <span class="block text-xs text-muted">
              {{
                line.quantity > 1
                  ? $t('receipt.facts', {
                      quantity: line.quantity,
                      price: line.unitPrice,
                      split: line.split,
                    })
                  : line.split
              }}
            </span>
            <span v-if="line.discountText" class="block text-xs text-muted">
              {{ $t('receipt.lineDiscountFact', { discount: line.discountText }) }}
            </span>
            <span v-if="line.deposit.numerator !== 0n" class="block text-xs text-muted">
              {{ $t('receipt.depositFact', { deposit: money(line.deposit) }) }}
            </span>
            <span v-if="line.unassigned.numerator !== 0n" class="block text-xs text-warning">
              {{ $t('receipt.notAssigned', { amount: money(line.unassigned) }) }}
            </span>
          </span>
          <span class="shrink-0 tabular-nums">{{ money(line.net) }}</span>
        </li>
      </ol>
      <p
        v-if="details.discount"
        class="flex items-start gap-2 border-t border-default py-1.5 text-sm"
      >
        <span class="min-w-0 flex-1">{{ $t('receipt.receiptDiscount') }}</span>
        <span class="shrink-0 tabular-nums">{{ details.discount }}</span>
      </p>
      <p
        v-if="details.deposits"
        class="flex items-start gap-2 border-t border-default py-1.5 text-sm"
      >
        <span class="min-w-0 flex-1">{{ $t('receipt.deposits') }}</span>
        <span class="shrink-0 tabular-nums">{{ money(details.deposits) }}</span>
      </p>
    </section>

    <section aria-labelledby="for-whom-heading">
      <h2 id="for-whom-heading" class="mt-5 mb-1 text-xs font-semibold text-muted uppercase">
        {{
          details.repayment
            ? $t('repayment.paidTo')
            : details.lineItems
              ? $t('receipt.shares')
              : $t('expense.forWhomEven')
        }}
      </h2>
      <ul>
        <li v-for="{ participant, share } in details.shares" :key="participant.id">
          <component
            :is="breakdowns ? 'button' : 'div'"
            :type="breakdowns ? 'button' : undefined"
            :aria-haspopup="breakdowns ? 'dialog' : undefined"
            class="flex w-full items-center gap-2.5 py-1.5 text-start"
            :class="{ 'cursor-pointer rounded-md hover:bg-elevated': breakdowns }"
            @click="breakdowns && openBreakdown(participant.id)"
          >
            <ParticipantAvatar :participant="participant" />
            <span
              class="min-w-0 flex-1 truncate"
              :class="{ 'font-semibold': participant.id === claim?.id }"
            >
              {{ participant.name }}
            </span>
            <span class="shrink-0 tabular-nums">{{ money(share) }}</span>
            <UIcon
              v-if="breakdowns"
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-dimmed"
              aria-hidden="true"
            />
          </component>
        </li>
      </ul>
      <p v-if="details.rounded" class="mt-1 text-xs text-muted">{{ $t('breakdown.rounded') }}</p>
      <p v-if="details.unassigned" class="mt-1 text-sm text-warning">
        {{
          $t('receipt.unassignedTotal', {
            amount: money(details.unassigned),
            name: details.payer?.name ?? '?',
          })
        }}
      </p>
    </section>

    <ShareBreakdownSheet
      v-if="opened"
      v-model:open="breakdownOpen"
      :participant="opened.participant"
      :breakdown="opened.breakdown"
      :currency="expense.currency"
    />
  </div>
</template>
