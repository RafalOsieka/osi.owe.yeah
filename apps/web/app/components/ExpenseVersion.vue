<script setup lang="ts">
import { expenseKind, expenseShares, type Expense, type Participant } from '@osi/owe-yeah-domain';
import type { ExpenseField } from '~/utils/revisions';

// One version of an Expense on the Conflict screen, as a card under `heading` (and
// `subtitle`, e.g. when it was made): whether it
// deletes the Expense, its title, total, when it was paid, who paid and who it is for, the
// claimed Participant as "you". What differs from the other version (`changed`) is
// highlighted and the rest stays quiet, with a line for differences it doesn't show (Line
// items, a Manual rate). The default slot ends the card, for the choice that keeps it.
const {
  expense,
  heading,
  subtitle = '',
  deleted,
  changed,
  claimId,
  participants,
} = defineProps<{
  expense: Expense;
  heading: string;
  subtitle?: string;
  deleted: boolean;
  changed: readonly ExpenseField[];
  claimId: string | null;
  participants: readonly Participant[];
}>();

const { t, locale } = useI18n();
const headingId = useId();

const nameOf = (id: string) =>
  id === claimId ? t('participants.you') : participants.find((p) => p.id === id)?.name;

const shown = computed(() => {
  const { total, shares } = expenseShares(expense);
  const hidden = changed.filter((field) => field === 'lineItems' || field === 'rate');
  return {
    total: formatMoney(total, expense.currency, locale.value),
    when: formatExpenseTime(expense.time, locale.value),
    payer: nameOf(expense.mainPayerId) ?? '?',
    income: expenseKind(expense).kind === 'income',
    // In the Trip's order.
    // "For all 4" when it is everyone, as the Expense list says it.
    forWhom:
      shares.size === participants.length
        ? t('conflict.forAll', { count: shares.size })
        : t('conflict.forWhom', {
            names: new Intl.ListFormat(locale.value).format(
              participants.filter(({ id }) => shares.has(id)).map(({ id }) => nameOf(id) ?? '?'),
            ),
          }),
    alsoDiffers:
      hidden.length > 0
        ? t('conflict.alsoDiffers', {
            fields: new Intl.ListFormat(locale.value).format(
              hidden.map((field) => t(`history.field.${field}`)),
            ),
          })
        : null,
  };
});

// A field's look: highlighted where the versions differ, quiet where they agree.
const look = (...fields: ExpenseField[]) =>
  fields.some((field) => changed.includes(field))
    ? 'rounded-md bg-warning/15 box-decoration-clone px-1.5 -mx-1.5 text-highlighted'
    : 'text-muted';
</script>

<template>
  <section :aria-labelledby="headingId" class="card p-4">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <h2 :id="headingId" class="font-semibold text-highlighted">{{ heading }}</h2>
        <p v-if="subtitle" class="text-sm text-muted">{{ subtitle }}</p>
      </div>
      <UBadge
        v-if="deleted"
        :label="$t('conflict.deleted')"
        color="neutral"
        variant="subtle"
        size="md"
      />
    </div>
    <p class="mt-2 font-medium wrap-anywhere">
      <span :class="look('title')">{{ expense.title }}</span>
    </p>
    <p class="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">
      <span :class="look('amount', 'currency')">{{ shown.total }}</span>
    </p>
    <p class="mt-1 text-sm">
      <span :class="look('when')">
        {{ $t('expense.timeInZone', { time: shown.when, zone: zoneName(expense.time.zone) }) }}
      </span>
    </p>
    <p class="mt-2 text-sm">
      <span :class="look('paidBy')">
        {{
          shown.income
            ? $t('conflict.receivedBy', { name: shown.payer })
            : $t('conflict.paidBy', { name: shown.payer })
        }}
      </span>
    </p>
    <p class="mt-1 text-sm wrap-anywhere">
      <span :class="look('forWhom')">
        {{ shown.forWhom }}
      </span>
    </p>
    <p v-if="shown.alsoDiffers" class="mt-1 text-sm">
      <span :class="look('lineItems', 'rate')">{{ shown.alsoDiffers }}</span>
    </p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </section>
</template>
