<script setup lang="ts">
import {
  conversionRate,
  multiply,
  rational,
  type Currency,
  type ManualRate,
} from '@osi/owe-yeah-domain';
import type { DraftManualRate, RepaymentReading } from '~/utils/expense-draft';

// The currency under the amount of the Expense and Repayment forms: the pill to pick it, what
// `total` comes to in the Trip currency ("≈" at a Provisional rate), and, in another currency
// than the Trip's, the Manual rate. That is typed as a rate ("1 USD = … EUR") or as the amount
// actually charged, in the currency it targets: the Trip currency, or the one it was typed for
// when it was saved before the Trip currency changed. It opens by itself when one is saved, and
// asks for one while there is no automatic rate. A Manual rate is for one currency, so picking
// another clears it and points it at the Trip currency again. The form reads and checks the
// Manual rate (`name` `manualRate`); a Trip rule it breaks shows as `error` while it stands.
const { reading, error = undefined } = defineProps<{
  /** The form's draft as read so far (`readDraft`): its total, time and Manual rate. */
  reading: Pick<RepaymentReading, 'total' | 'time' | 'manualRate'>;
  error?: string;
}>();
const currency = defineModel<Currency>('currency', { required: true });
const manualRate = defineModel<DraftManualRate>('manualRate', { required: true });

const { trip } = useOpenTrip();
const { t, locale } = useI18n();

watch(currency, () => {
  manualRate.value = { ...manualRate.value, value: '', currency: trip.value.currency };
});

const foreign = computed(() => currency.value !== trip.value.currency);

// No automatic rate for the Expense's date and currency on this device.
const missing = computed(
  () =>
    foreign.value &&
    reading.time !== null &&
    conversionRate(
      { currency: currency.value, time: reading.time, total: rational(1n) },
      trip.value,
    ) === null,
);

const opened = ref(false);
const shown = computed(
  () => foreign.value && (opened.value || manualRate.value.value !== '' || missing.value),
);

// The total in the Trip currency, or why there is none; `null` when there is nothing to say.
const converted = computed(() => {
  const { time, total, manualRate: typed } = reading;
  if (!foreign.value || time === null || typed === 'unreadable') return null;
  if (total === null) return typed === undefined && missing.value ? t('rate.noRate') : null;
  const found = conversionRate(
    { currency: currency.value, time, manualRate: typed, total },
    trip.value,
  );
  if (!found) return t('rate.noRate');
  return formatMoney(
    multiply(total, found.rate),
    trip.value.currency,
    locale.value,
    'currency',
    found.provisional,
  );
});

const help = computed(() => {
  if (missing.value && manualRate.value.value === '') {
    return t('rate.askManual', { from: currency.value });
  }
  return manualRate.value.kind === 'rate'
    ? t('rate.rateHelp', { from: currency.value, to: manualRate.value.currency })
    : t('rate.chargedHelp', { to: manualRate.value.currency });
});

const kinds = computed(() =>
  (['charged', 'rate'] as const satisfies readonly ManualRate['kind'][]).map((value) => ({
    value,
    label: value === 'rate' ? t('rate.kindRate') : t('rate.kindCharged'),
  })),
);
const kind = computed({
  get: () => manualRate.value.kind,
  set: (value: ManualRate['kind']) => (manualRate.value = { ...manualRate.value, kind: value }),
});
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-center gap-2">
      <CurrencyPill v-model="currency" />
      <span v-if="converted" class="text-sm text-muted tabular-nums">{{ converted }}</span>
      <UButton
        v-if="foreign && !shown"
        variant="link"
        size="sm"
        :label="$t('rate.typeManual')"
        class="p-0"
        @click="opened = true"
      />
    </div>

    <UFormField
      v-if="shown"
      name="manualRate"
      :label="$t('rate.manual')"
      :description="help"
      :error="error"
    >
      <div class="flex items-center gap-2">
        <span v-if="manualRate.kind === 'rate'" class="shrink-0 text-sm text-muted">
          {{ $t('rate.ratePrefix', { from: currency }) }}
        </span>
        <UInput
          :model-value="manualRate.value"
          inputmode="decimal"
          placeholder="0"
          class="min-w-0 flex-1"
          @update:model-value="manualRate = { ...manualRate, value: String($event) }"
        >
          <template #trailing>
            <span class="text-sm text-muted">{{ manualRate.currency }}</span>
          </template>
        </UInput>
        <SegmentedControl
          v-model="kind"
          :options="kinds"
          :label="$t('rate.manualKind')"
          class="shrink-0"
        />
      </div>
    </UFormField>
  </div>
</template>
