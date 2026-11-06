<script setup lang="ts">
import {
  conversionRate,
  multiply,
  rational,
  type Currency,
  type ManualRate,
} from '@osi/owe-yeah-domain';
import type { DraftManualRate, RepaymentReading } from '~/utils/expense-draft';

// What the Expense and Repayment forms say under their amount about its currency (picked with
// the `CurrencyPill` beside the amount): in another currency than the Trip's, what `total`
// comes to in the Trip currency ("≈" at a Provisional rate), and the Currency conversion, in
// its own section across the bottom of the amount card: a Manual rate, typed as the amount
// actually charged or as a rate ("1 HUF = … EUR"), chosen above the field, whose label says
// which it holds, in the currency it targets: the Trip currency, or the one it was typed for
// when it was saved before the Trip currency changed. Under it, the rate it comes to, the
// readable way round ("1 EUR ≈ 397.52 HUF"); the converted total is left out while it is the
// amount charged typed below. It opens by itself when one is saved, and asks for one when the
// provider doesn't cover the currency, saying so. The automatic rate is looked up from the
// server for the currency and date typed (`useRateLookup`); while it can't be, it says the rate
// comes once synced. A Manual rate is for one currency, so picking another clears it and points
// it at the Trip currency again. The form reads and checks the Manual rate (`name`
// `manualRate`); a Trip rule it breaks shows as `error` while it stands.
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

const lookup = useRateLookup(() => {
  const { time, manualRate: typed } = reading;
  if (time === null) return null;
  return { currency: currency.value, time, manualRate: typed === 'unreadable' ? undefined : typed };
});

// No automatic rate, as the provider doesn't cover the currency: a Manual rate is needed.
const notCovered = computed(() => missing.value && lookup.value === 'notCovered');

// Why there is no rate to convert at; nothing while the server is asked.
const noRate = computed(() => {
  if (lookup.value === 'checking' || lookup.value === 'found') return null;
  return lookup.value === 'unknown' ? t('rate.onSync') : t('rate.noRate');
});

const opened = ref(false);
const shown = computed(
  () => foreign.value && (opened.value || manualRate.value.value !== '' || notCovered.value),
);

// The rate the total is converted at, with the Manual rate typed if any; `null` while the
// total, time or Manual rate can't be read, or there is no rate.
const found = computed(() => {
  const { time, total, manualRate: typed } = reading;
  if (!foreign.value || time === null || total === null || typed === 'unreadable') return null;
  return conversionRate({ currency: currency.value, time, manualRate: typed, total }, trip.value);
});

// The total in the Trip currency, or why there is none; `null` when there is nothing to say,
// as when it is the amount charged typed in the field.
const converted = computed(() => {
  const { time, total, manualRate: typed } = reading;
  if (!foreign.value || time === null || typed === 'unreadable') return null;
  if (typed?.kind === 'charged') return null;
  if (total === null) return typed === undefined && missing.value ? noRate.value : null;
  if (!found.value) return noRate.value;
  return formatMoney(
    multiply(total, found.value.rate),
    trip.value.currency,
    locale.value,
    'currency',
    found.value.provisional,
  );
});

// The rate the Manual rate comes to, to check against the bank's.
const derived = computed(() =>
  found.value && reading.manualRate
    ? t('rate.derivedRate', {
        rate: readableRate(
          found.value.rate,
          currency.value,
          manualRate.value.currency,
          locale.value,
        ),
      })
    : null,
);

const help = computed(() =>
  manualRate.value.kind === 'rate'
    ? t('rate.rateHelp', { from: currency.value, to: manualRate.value.currency })
    : t('rate.chargedHelp', { to: manualRate.value.currency, from: currency.value }),
);

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
const value = computed({
  get: () => manualRate.value.value,
  set: (value: string) => (manualRate.value = { ...manualRate.value, value }),
});
</script>

<template>
  <div>
    <div
      v-if="converted || (foreign && !shown)"
      class="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 px-1"
    >
      <span v-if="converted" class="text-sm text-muted tabular-nums">{{ converted }}</span>
      <UButton
        v-if="foreign && !shown"
        variant="link"
        :label="$t('rate.typeManual')"
        class="-me-2.5 ms-auto"
        @click="opened = true"
      />
    </div>

    <section
      v-if="shown"
      :aria-label="$t('rate.conversion')"
      class="-mx-4 mt-3 space-y-3 border-t border-default px-4 pt-4 text-start"
    >
      <div>
        <h3 class="text-sm font-medium text-highlighted">{{ $t('rate.conversion') }}</h3>
        <p v-if="notCovered" class="mt-0.5 text-sm text-muted">
          {{
            manualRate.value === ''
              ? $t('rate.askManual', { from: currency })
              : $t('rate.noAutomatic', { from: currency })
          }}
        </p>
      </div>
      <SegmentedControl
        v-model="kind"
        :options="kinds"
        :label="$t('rate.manualKind')"
        class="flex w-full"
      />
      <UFormField
        name="manualRate"
        :label="
          kind === 'rate'
            ? $t('rate.rateLabel')
            : $t('rate.chargedLabel', { to: manualRate.currency })
        "
        :help="help"
        :error="error"
      >
        <div v-if="kind === 'rate'" class="flex items-center gap-2">
          <span class="shrink-0 text-sm text-muted">
            {{ $t('rate.ratePrefix', { from: currency }) }}
          </span>
          <MoneyInput
            v-model="value"
            :currency="manualRate.currency"
            bare
            placeholder="0"
            class="min-w-0 flex-1"
          />
          <span class="shrink-0 text-sm text-muted">{{ manualRate.currency }}</span>
        </div>
        <MoneyInput v-else v-model="value" :currency="manualRate.currency" class="w-full" />
      </UFormField>
      <p v-if="derived" class="text-sm text-default tabular-nums">{{ derived }}</p>
    </section>
  </div>
</template>
