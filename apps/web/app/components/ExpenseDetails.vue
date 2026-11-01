<script setup lang="ts">
import {
  expenseShares,
  fromMinor,
  isReceipt,
  isRepayment,
  type Expense,
  type Rational,
} from '@osi/owe-yeah-domain';

// An Expense in full, as its detail page and an old Revision show it: the full title, total,
// when it was paid in its own zone, the Main payer (who received it, for Income), and each
// Participant's share, the claimed Participant's in bold. A Repayment shows who paid whom. A
// Receipt also lists its Line items, with how each is split and what is not assigned yet.
const { expense } = defineProps<{ expense: Expense }>();

const { trip, claim } = useOpenTrip();
const { t, locale } = useI18n();
const splitText = useSplitText();

const money = (amount: Rational) => formatMoney(amount, expense.currency, locale.value);

const details = computed(() => {
  const { total, shares, unassigned, lineItems } = expenseShares(expense);
  const receipt = isReceipt(expense) && !isRepayment(expense);
  return {
    total,
    unassigned: unassigned.numerator === 0n ? null : unassigned,
    lineItems: receipt
      ? expense.lineItems.map((item, index) => ({
          name: item.name || t('receipt.unnamed', { position: index + 1 }),
          quantity: item.quantity,
          unitPrice: formatMoney(
            fromMinor(item.unitPrice, expense.currency),
            expense.currency,
            locale.value,
            'number',
          ),
          split: splitText(item.split, trip.value.participants),
          ...lineItems[index]!,
        }))
      : null,
    repayment: isRepayment(expense),
    income: total.numerator < 0n,
    when: formatExpenseTime(expense.time, locale.value),
    payer: trip.value.participants.find(({ id }) => id === expense.mainPayerId),
    // In the Trip's order.
    shares: trip.value.participants.flatMap((participant) => {
      const share = shares.get(participant.id);
      return share ? [{ participant, share }] : [];
    }),
  };
});
</script>

<template>
  <div>
    <p class="text-xl leading-tight font-bold wrap-anywhere">{{ expense.title }}</p>
    <p class="mt-0.5 text-3xl font-bold tabular-nums">{{ money(details.total) }}</p>
    <p class="text-sm text-muted">
      {{ $t('expense.timeInZone', { time: details.when, zone: expense.time.zone }) }}
    </p>

    <section aria-labelledby="paid-by-heading">
      <h2 id="paid-by-heading" class="mt-5 mb-1 text-xs font-semibold text-muted uppercase">
        {{ details.income ? $t('expense.receivedBy') : $t('expense.paidBy') }}
      </h2>
      <div v-if="details.payer" class="flex items-center gap-2.5 py-1.5">
        <ParticipantAvatar :participant="details.payer" />
        <span class="min-w-0 flex-1 truncate">{{ details.payer.name }}</span>
        <span class="shrink-0 tabular-nums">{{ money(details.total) }}</span>
      </div>
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
            <span v-if="line.unassigned.numerator !== 0n" class="block text-xs text-warning">
              {{ $t('receipt.notAssigned', { amount: money(line.unassigned) }) }}
            </span>
          </span>
          <span class="shrink-0 tabular-nums">{{ money(line.total) }}</span>
        </li>
      </ol>
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
        <li
          v-for="{ participant, share } in details.shares"
          :key="participant.id"
          class="flex items-center gap-2.5 py-1.5"
        >
          <ParticipantAvatar :participant="participant" />
          <span
            class="min-w-0 flex-1 truncate"
            :class="{ 'font-semibold': participant.id === claim?.id }"
          >
            {{ participant.name }}
          </span>
          <span class="shrink-0 tabular-nums">{{ money(share) }}</span>
        </li>
      </ul>
      <p v-if="details.unassigned" class="mt-1 text-sm text-warning">
        {{
          $t('receipt.unassignedTotal', {
            amount: money(details.unassigned),
            name: details.payer?.name ?? '?',
          })
        }}
      </p>
    </section>
  </div>
</template>
