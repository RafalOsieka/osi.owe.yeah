<script setup lang="ts">
import {
  fromMinor,
  groupByLocalDay,
  localDateTime,
  type Participant,
  type StoredExpense,
} from '@osi/owe-yeah-domain';

// The Trip's Expenses, newest first, under a heading for each Expense's own local day.
// Emits the Expense a Participant opens to edit.
const { expenses, participants } = defineProps<{
  expenses: readonly StoredExpense[];
  participants: readonly Participant[];
}>();
const emit = defineEmits<{ open: [expense: StoredExpense] }>();

const { locale } = useI18n();

const days = computed(() => groupByLocalDay(expenses));
const names = computed(() => new Map(participants.map(({ id, name }) => [id, name])));

// A local day (`YYYY-MM-DD`) in words. It is a calendar date, not an instant, so it is
// formatted in UTC to keep the device's zone from shifting it.
function dayHeading(day: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

function total(expense: StoredExpense): string {
  const minor = expense.lineItems.reduce((sum, { unitPrice }) => sum + unitPrice, 0);
  return formatMoney(fromMinor(minor, expense.currency), expense.currency, locale.value);
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="{ day, expenses: onDay } in days" :key="day" class="space-y-2">
      <h3 class="text-sm font-medium text-muted">{{ dayHeading(day) }}</h3>
      <ul class="space-y-2">
        <li v-for="expense in onDay" :key="expense.id">
          <UButton
            color="neutral"
            variant="outline"
            block
            class="justify-between text-left"
            @click="emit('open', expense)"
          >
            <span class="flex flex-col">
              <span class="font-medium">{{ expense.title }}</span>
              <span class="text-xs text-muted">
                {{
                  $t('expense.summary', {
                    name: names.get(expense.mainPayerId) ?? '?',
                    time: localDateTime(expense.time).slice(11),
                  })
                }}
              </span>
            </span>
            <span class="font-medium tabular-nums">{{ total(expense) }}</span>
          </UButton>
        </li>
      </ul>
    </div>
  </div>
</template>
