<script setup lang="ts">
import {
  add,
  expenseKind,
  expenseRate,
  expenseShares,
  fromMinor,
  isDepositRefund,
  decimal,
  multiply,
  rational,
  roundMoney,
  shareBreakdown,
  type Discount,
  type Expense,
  type LineItem,
  type LineItemShares,
  type Participant,
  type Rational,
} from '@osi/owe-yeah-domain';

// An Expense in full, as its detail page and an old Revision show it: the full title, total,
// when it was paid in its own zone, the Main payer (who received it, for Income) with their
// part, named Main payer beside any Contribution from others, and each Participant's share;
// the claimed Participant is marked "you" wherever they appear. A Repayment says who paid whom
// once, with the amount, in its header. A Receipt also lists its Line items, each amount level
// with its name, with how each is split (an Amounts split with each one's amount), its Line
// discount, its Deposit, and what is not assigned yet (in units, for a Units split), Deposit
// refunds marked as such; then a summary of the Line items, the Receipt discount, the
// Deposits and the total. What is not assigned yet is counted in the Main payer's share, whose
// row says how much. On a Receipt, tapping a share opens where it comes from
// (`ShareBreakdownSheet`). Shares are rounded only to show them, so a note explains "≈" when
// they don't add up to the total. All
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
const isYou = (participant: Participant) => participant.id === claim.value?.id;
// The "you" next to the claimed Participant's name, wherever it appears.
const youBadge = computed(
  () =>
    ({
      label: t('participants.you'),
      variant: 'subtle',
      size: 'md',
      class: 'ms-1.5 align-middle text-[0.8125rem]',
    }) as const,
);

// What is not assigned yet of a Line item, said once, on it: the units for a Units split
// ("1 of 4 units unassigned"), the amount otherwise.
function unassignedText(item: LineItem, shares: LineItemShares): string | null {
  if (shares.unassigned.numerator === 0n) return null;
  if (item.split.mode !== 'units') {
    return t('receipt.notAssigned', { amount: money(shares.unassigned) });
  }
  const assigned = item.split.parts.reduce((sum, { units }) => sum + units, 0);
  return t('receipt.unitsUnassigned', {
    unassigned: item.quantity - assigned,
    quantity: item.quantity,
  });
}

// How a Line item is split, an Amounts split with each one's amount ("Amounts · Kasia €7.25,
// Marta €7.25").
function splitOf(item: LineItem, shares: LineItemShares): string {
  if (item.split.mode !== 'amounts') return splitText(item.split, everyone.value);
  const parts = item.split.parts.map(({ participantId }) => {
    const name = everyone.value.find(({ id }) => id === participantId)?.name ?? '?';
    const part = shares.shares.get(participantId);
    return part ? `${name} ${money(part)}` : name;
  });
  return `${t('receipt.mode.amounts')} · ${new Intl.ListFormat(locale.value, { style: 'narrow' }).format(parts)}`;
}

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
          refund: isDepositRefund(item),
          name:
            item.name ||
            (isDepositRefund(item)
              ? t('receipt.depositRefund')
              : t('receipt.unnamed', { position: index + 1 })),
          // E.g. "6 × €1.29 · Units · Ania 1, Tomek 3", a named Deposit refund marked as one.
          facts: [
            isDepositRefund(item) && item.name ? t('receipt.depositRefund') : null,
            item.quantity > 1
              ? t('receipt.facts', {
                  quantity: item.quantity,
                  price: money(fromMinor(item.unitPrice, expense.currency)),
                  split: splitOf(item, lineItems[index]!),
                })
              : splitOf(item, lineItems[index]!),
          ]
            .filter((fact) => fact !== null)
            .join(' · '),
          unassignedText: unassignedText(item, lineItems[index]!),
          ...lineItems[index]!,
        }))
      : null,
    // The Line items after their own discounts, before the Receipt discount and Deposits.
    subtotal: lineItems.reduce((sum, { net }) => add(sum, net), rational(0n)),
    repayment: kind === 'repayment',
    recipient:
      kind === 'repayment'
        ? everyone.value.find(({ id }) => id === narrowed.recipientId)
        : undefined,
    income: kind === 'income',
    when: formatExpenseTime(expense.time, locale.value),
    payer: everyone.value.find(({ id }) => id === expense.mainPayerId),
    // The Main payer first, then the Contributions in the order they were added.
    payers: [...paid].flatMap(([id, amount]) => {
      const participant = everyone.value.find((other) => other.id === id);
      return participant
        ? [
            {
              participant,
              amount,
              contribution: id !== expense.mainPayerId,
              you: isYou(participant),
            },
          ]
        : [];
    }),
    // In the Trip's order.
    shares: everyone.value.flatMap((participant) => {
      const share = shares.get(participant.id);
      // What is not assigned yet counts as the Main payer's own until it is.
      const unassignedHere = participant.id === expense.mainPayerId && unassigned.numerator !== 0n;
      return share ? [{ participant, share, you: isYou(participant), unassignedHere }] : [];
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
    <div class="card px-5 py-6 text-center">
      <p class="text-lg leading-snug font-medium text-highlighted wrap-anywhere">
        {{ expense.title }}
      </p>
      <p class="mt-1 text-5xl font-semibold tracking-tight text-highlighted tabular-nums">
        {{ money(details.total) }}
      </p>
      <template v-if="conversion">
        <p class="mt-2 font-medium tabular-nums">{{ conversion.text }}</p>
        <p v-if="conversion.manual" class="text-sm text-muted tabular-nums">
          {{ conversion.manual }}
        </p>
        <p v-if="conversion.help" class="mt-1 text-sm text-warning">{{ conversion.help }}</p>
      </template>
      <!-- Who paid whom, for a Repayment: said once, here. -->
      <p
        v-if="details.repayment && details.payer && details.recipient"
        class="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1"
      >
        <span class="flex items-center gap-2">
          <ParticipantAvatar :participant="details.payer" size="sm" />
          <span class="text-highlighted">{{ details.payer.name }}</span>
          <UBadge v-if="isYou(details.payer)" v-bind="youBadge" />
        </span>
        <UIcon name="i-lucide-arrow-right" class="size-4 text-muted" aria-hidden="true" />
        <span class="sr-only">{{ $t('repayment.paidTo') }}</span>
        <span class="flex items-center gap-2">
          <ParticipantAvatar :participant="details.recipient" size="sm" />
          <span class="text-highlighted">{{ details.recipient.name }}</span>
          <UBadge v-if="isYou(details.recipient)" v-bind="youBadge" />
        </span>
      </p>
      <p class="mt-3 text-sm text-muted">
        {{ $t('expense.timeInZone', { time: details.when, zone: zoneName(expense.time.zone) }) }}
      </p>
    </div>

    <section v-if="!details.repayment" aria-labelledby="paid-by-heading">
      <h2 id="paid-by-heading" class="section-heading mt-7">
        {{ details.income ? $t('expense.receivedBy') : $t('expense.paidBy') }}
      </h2>
      <ul class="card divide-y divide-default">
        <li
          v-for="{ participant, amount, contribution, you } in details.payers"
          :key="participant.id"
          class="flex items-center gap-3 px-4 py-3"
        >
          <ParticipantAvatar :participant="participant" size="md" />
          <span class="min-w-0 flex-1 leading-snug">
            <span class="block truncate text-highlighted">
              {{ participant.name }}
              <UBadge v-if="you" v-bind="youBadge" />
            </span>
            <span v-if="details.payers.length > 1" class="block text-sm text-muted">
              {{ contribution ? $t('contribution.label') : $t('contribution.mainPayer') }}
            </span>
          </span>
          <span class="shrink-0 font-medium text-highlighted tabular-nums">
            {{ money(amount) }}
          </span>
        </li>
      </ul>
    </section>

    <section v-if="details.lineItems" aria-labelledby="line-items-heading">
      <h2 id="line-items-heading" class="section-heading mt-7">
        {{ $t('receipt.lineItems') }}
      </h2>
      <div class="card overflow-hidden">
        <ol class="divide-y divide-default">
          <li
            v-for="(line, index) in details.lineItems"
            :key="index"
            class="flex items-start gap-3 px-4 py-3"
            :class="{ 'shadow-[inset_3px_0_0_var(--ui-warning)]': line.unassignedText }"
          >
            <span class="min-w-0 flex-1 leading-snug">
              <span class="block text-highlighted wrap-anywhere">{{ line.name }}</span>
              <span class="mt-0.5 flex items-center gap-1 text-sm text-muted">
                <UIcon
                  v-if="line.refund"
                  name="i-lucide-undo-2"
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {{ line.facts }}
              </span>
              <span v-if="line.discountText" class="block text-sm text-muted">
                {{ $t('receipt.lineDiscountFact', { discount: line.discountText }) }}
              </span>
              <span v-if="line.deposit.numerator !== 0n" class="block text-sm text-muted">
                {{ $t('receipt.depositFact', { deposit: money(line.deposit) }) }}
              </span>
              <span
                v-if="line.unassignedText"
                class="mt-0.5 flex items-center gap-1 text-sm font-medium text-warning"
              >
                <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" aria-hidden="true" />
                {{ line.unassignedText }}
              </span>
            </span>
            <span class="shrink-0 font-medium text-highlighted tabular-nums">
              {{ money(line.net) }}
            </span>
          </li>
        </ol>
        <!-- What the Receipt comes to, apart from its Line items. -->
        <dl
          v-if="details.discount || details.deposits"
          class="border-t border-default bg-elevated/40 px-4 py-2 tabular-nums"
        >
          <div class="flex justify-between gap-3 py-1 text-sm">
            <dt class="text-muted">{{ $t('receipt.subtotal') }}</dt>
            <dd class="shrink-0">{{ money(details.subtotal) }}</dd>
          </div>
          <div v-if="details.discount" class="flex justify-between gap-3 py-1 text-sm">
            <dt class="text-muted">{{ $t('receipt.receiptDiscount') }}</dt>
            <dd class="shrink-0">{{ details.discount }}</dd>
          </div>
          <div v-if="details.deposits" class="flex justify-between gap-3 py-1 text-sm">
            <dt class="text-muted">{{ $t('receipt.deposits') }}</dt>
            <dd class="shrink-0">{{ money(details.deposits) }}</dd>
          </div>
          <div
            class="mt-1 flex justify-between gap-3 border-t border-default pt-2 pb-1 font-semibold text-highlighted"
          >
            <dt>{{ $t('receipt.total') }}</dt>
            <dd class="shrink-0">{{ money(details.total) }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section v-if="!details.repayment" aria-labelledby="for-whom-heading">
      <h2 id="for-whom-heading" class="section-heading mt-7">
        {{ details.lineItems ? $t('receipt.shares') : $t('expense.forWhomEven') }}
      </h2>
      <ul class="card divide-y divide-default overflow-hidden">
        <li
          v-for="{ participant, share, you, unassignedHere } in details.shares"
          :key="participant.id"
        >
          <component
            :is="breakdowns ? 'button' : 'div'"
            :type="breakdowns ? 'button' : undefined"
            :aria-haspopup="breakdowns ? 'dialog' : undefined"
            class="flex w-full items-center gap-3 px-4 py-3 text-start"
            :class="{ 'cursor-pointer transition-colors hover:bg-elevated/60': breakdowns }"
            @click="breakdowns && openBreakdown(participant.id)"
          >
            <ParticipantAvatar :participant="participant" size="md" />
            <span class="min-w-0 flex-1 leading-snug">
              <span class="block truncate text-highlighted">
                {{ participant.name }}
                <UBadge v-if="you" v-bind="youBadge" />
              </span>
              <span v-if="unassignedHere && details.unassigned" class="block text-sm text-warning">
                {{ $t('receipt.includesUnassigned', { amount: money(details.unassigned) }) }}
              </span>
            </span>
            <span class="shrink-0 font-medium text-highlighted tabular-nums">
              {{ money(share) }}
            </span>
            <UIcon
              v-if="breakdowns"
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-dimmed"
              aria-hidden="true"
            />
          </component>
        </li>
      </ul>
      <p v-if="details.rounded" class="mt-2 px-1 text-sm text-muted">
        {{ $t('breakdown.rounded') }}
      </p>
    </section>

    <ShareBreakdownSheet
      v-if="opened"
      v-model:open="breakdownOpen"
      :participant="opened.participant"
      :breakdown="opened.breakdown"
      :currency="expense.currency"
      :claim-id="claim?.id"
      :context="expense.title"
    />
  </div>
</template>
