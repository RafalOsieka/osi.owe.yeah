<script setup lang="ts">
import { currencyChangeBlocked, tripNameSchema, type Trip } from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';

// "Name and Trip currency", opened from the Trip tab: the last change wins, with no Conflict
// screen, and the page says who made it and when. Until Expenses are converted (#36), the
// picker only offers Trip currencies every Expense is in already, deleted ones included.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, everyone, saveTripDetails } = useOpenTrip();
const { t, locale } = useI18n();
const back = useBack();
const allCurrencies = useTripCurrencies();

const parent = computed(() => `/trips/${trip.value.id}/settings`);
const state = reactive<Omit<Trip, 'id'>>({ name: trip.value.name, currency: trip.value.currency });

const currencies = computed(() => {
  const expenses = [...trip.value.expenses, ...trip.value.deletedExpenses];
  return allCurrencies.value.filter(({ value }) => !currencyChangeBlocked(expenses, value));
});
const currencyLocked = computed(() => currencies.value.length <= 1);

// "Last changed by Kasia, 2 hr. ago", by the server's clock once it has the change.
const lastChanged = computed(() => {
  const { edited } = trip.value;
  if (!edited) return null;
  const name = everyone.value.find(({ id }) => id === edited.by)?.name;
  const when = edited.at
    ? formatTimeAgo(edited.at, new Date(), locale.value)
    : t('history.notSyncedYet');
  return name
    ? t('trip.details.lastChangedBy', { name, when })
    : t('trip.details.lastChanged', { when });
});

// Set when an Expense in the old Trip currency arrived while the form was open.
const currencyRefused = ref(false);

function validate(details: Partial<typeof state>): FormError[] {
  const errors: FormError[] = [];
  if (!tripNameSchema.safeParse(details.name).success) {
    errors.push({ name: 'name', message: t('trip.create.nameInvalid') });
  }
  return errors;
}

async function save(): Promise<void> {
  const saved = await saveTripDetails({ ...state, name: tripNameSchema.parse(state.name) });
  if (saved) await back(parent.value);
  else currencyRefused.value = true;
}

useHead({ title: () => t('trip.details.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('trip.details.title')" :parent="parent">
    <UForm id="trip-details" :state="state" :validate="validate" class="space-y-4" @submit="save">
      <UFormField name="name" :label="$t('trip.create.name')">
        <UInput v-model="state.name" class="w-full" />
      </UFormField>
      <UFormField
        name="currency"
        :label="$t('trip.create.currency')"
        :help="currencyLocked ? $t('trip.details.currencyLocked') : $t('trip.create.currencyHelp')"
        :error="currencyRefused && $t('trip.details.currencyLocked')"
      >
        <USelectMenu
          v-model="state.currency"
          :items="currencies"
          value-key="value"
          :disabled="currencyLocked"
          class="w-full"
          @update:model-value="currencyRefused = false"
        />
      </UFormField>
    </UForm>
    <p v-if="lastChanged" class="mt-6 text-sm text-muted">{{ lastChanged }}</p>

    <template #action>
      <UButton type="submit" form="trip-details" block size="xl" :label="$t('trip.details.save')" />
    </template>
  </NuxtLayout>
</template>
