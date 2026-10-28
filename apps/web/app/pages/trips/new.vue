<script setup lang="ts">
import { TRIP_CURRENCIES, tripNameSchema, type Trip } from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import { v7 as uuidv7 } from 'uuid';

const { t, locale } = useI18n();

useHead({ title: () => t('trip.create.title') });

const state = reactive<Omit<Trip, 'id'>>({ name: '', currency: 'EUR' });
const failed = ref(false);

const currencyNames = computed(() => new Intl.DisplayNames([locale.value], { type: 'currency' }));
const currencies = computed(() =>
  TRIP_CURRENCIES.map((code) => ({
    value: code,
    label: `${code} · ${currencyNames.value.of(code)}`,
  })),
);

// The domain rule for names, worded for the form; the currency picker only offers valid ones.
function validate(trip: Partial<Omit<Trip, 'id'>>): FormError[] {
  return tripNameSchema.safeParse(trip.name).success
    ? []
    : [{ name: 'name', message: t('trip.create.nameInvalid') }];
}

// The id is generated here, on the device; the server answers with the Trip link's token,
// which travels in the link's fragment so it never reaches server logs.
async function create(): Promise<void> {
  failed.value = false;
  const id = uuidv7();
  try {
    const { token } = await $fetch('/api/trips', { method: 'POST', body: { id, ...state } });
    await navigateTo({ path: `/trips/${id}`, hash: `#${token}` });
  } catch {
    failed.value = true;
  }
}
</script>

<template>
  <UPage>
    <UPageHeader :title="$t('trip.create.title')" />
    <UPageBody>
      <UForm :state="state" :validate="validate" class="max-w-md space-y-4" @submit="create">
        <UFormField name="name" :label="$t('trip.create.name')">
          <UInput
            v-model="state.name"
            :placeholder="$t('trip.create.namePlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="currency"
          :label="$t('trip.create.currency')"
          :help="$t('trip.create.currencyHelp')"
        >
          <USelectMenu
            v-model="state.currency"
            :items="currencies"
            value-key="value"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="failed"
          color="error"
          icon="i-lucide-circle-alert"
          :title="$t('trip.create.failed')"
        />
        <UButton type="submit" :label="$t('trip.create.submit')" />
      </UForm>
    </UPageBody>
  </UPage>
</template>
