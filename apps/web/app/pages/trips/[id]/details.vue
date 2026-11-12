<script setup lang="ts">
import {
  TRIP_CURRENCIES,
  tripCurrencyLocked,
  tripNameSchema,
  type Trip,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';

// "Name and Trip currency", opened from the Trip tab: the last change wins, with no Conflict
// screen, and the page says who made it and when. A new Trip currency rewrites no Expense:
// each is converted at the rate for the new pair (ADR 0003), which the field says once another
// currency is picked. Once the Trip has a Repayment the Trip currency can't change
// (`tripCurrencyLocked`): the field is disabled and says why. Save waits for a change.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, everyone, saveTripDetails } = useOpenTrip();
const { t, locale } = useI18n();
const back = useBack();
const currencies = useCurrencyItems(TRIP_CURRENCIES);

const parent = computed(() => `/trips/${trip.value.id}/settings`);
const locked = computed(() => tripCurrencyLocked(trip.value.expenses));
const state = reactive<Omit<Trip, 'id'>>({ name: trip.value.name, currency: trip.value.currency });
const changed = computed(
  () => state.name.trim() !== trip.value.name || state.currency !== trip.value.currency,
);

// "Last changed by Kasia · 2 hours ago" ("by you" for this device's Claim), by the server's
// clock once it has the change.
const lastChanged = computed(() => {
  const { edited } = trip.value;
  if (!edited) return null;
  const author = whoMadeIt(edited.by, claim.value, everyone.value);
  const when = formatEditedAt(edited.at, new Date(), locale.value, {
    justNow: t('history.justNow'),
    notSyncedYet: t('history.notSyncedYet'),
  });
  switch (author.is) {
    case 'you':
      return t('trip.details.lastChangedByYou', { when });
    case 'named':
      return t('trip.details.lastChangedBy', { name: author.participant.name, when });
    case 'nobody':
      return t('trip.details.lastChanged', { when });
  }
});

function validate(details: Partial<typeof state>): FormError[] {
  const errors: FormError[] = [];
  if (!tripNameSchema.safeParse(details.name).success) {
    errors.push({ name: 'name', message: t('trip.create.nameInvalid') });
  }
  return errors;
}

// A Repayment synced in while the page was open keeps the Trip currency: the field shows why.
async function save(): Promise<void> {
  const saved = await saveTripDetails({ ...state, name: tripNameSchema.parse(state.name) });
  if (!saved) {
    state.currency = trip.value.currency;
    return;
  }
  await back(parent.value);
}

useHead({ title: () => t('trip.details.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('trip.details.title')" :parent="parent">
    <UForm
      id="trip-details"
      :state="state"
      :validate="validate"
      class="card space-y-4 p-4"
      @submit="save"
    >
      <UFormField name="name" :label="$t('trip.create.name')">
        <UInput v-model="state.name" class="w-full" />
      </UFormField>
      <UFormField
        name="currency"
        :label="$t('trip.create.currency')"
        :help="
          locked
            ? $t('trip.details.currencyLocked')
            : state.currency === trip.currency
              ? $t('trip.details.currencyHelp')
              : $t('trip.details.currencyChange', { currency: state.currency })
        "
      >
        <USelectMenu
          v-model="state.currency"
          :items="currencies"
          value-key="value"
          :disabled="locked"
          class="w-full"
        />
      </UFormField>
    </UForm>
    <p v-if="lastChanged" class="mt-3 px-4 text-sm text-muted">{{ lastChanged }}</p>

    <template #action>
      <UButton
        type="submit"
        form="trip-details"
        block
        size="xl"
        :disabled="!changed"
        class="disabled:bg-accented disabled:text-muted disabled:opacity-100"
        :label="$t('trip.details.save')"
      />
    </template>
  </NuxtLayout>
</template>
