<script setup lang="ts">
import {
  TRIP_CURRENCIES,
  participantNameSchema,
  tripNameSchema,
  type Trip,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import { v7 as uuidv7 } from 'uuid';

const { t, locale } = useI18n();

useHead({ title: () => t('trip.create.title') });

// Participant names as typed, one field each; blank fields are left out on creation.
type TripForm = Omit<Trip, 'id'> & { participants: string[] };

const state = reactive<TripForm>({ name: '', currency: 'EUR', participants: [''] });
const failed = ref(false);

const currencyNames = computed(() => new Intl.DisplayNames([locale.value], { type: 'currency' }));
const currencies = computed(() =>
  TRIP_CURRENCIES.map((code) => ({
    value: code,
    label: `${code} · ${currencyNames.value.of(code)}`,
  })),
);

// The domain rules for names, worded for the form; the currency picker only offers valid ones.
function validate(trip: Partial<TripForm>): FormError[] {
  const errors: FormError[] = tripNameSchema.safeParse(trip.name).success
    ? []
    : [{ name: 'name', message: t('trip.create.nameInvalid') }];
  (trip.participants ?? []).forEach((name, index) => {
    if (name.trim() !== '' && !participantNameSchema.safeParse(name).success) {
      errors.push({ name: `participants.${index}`, message: t('participants.nameInvalid') });
    }
  });
  return errors;
}

// The ids are generated here, on the device; the server answers with the Trip link's token,
// which travels in the link's fragment so it never reaches server logs.
async function create(): Promise<void> {
  failed.value = false;
  const id = uuidv7();
  const participants = state.participants
    .filter((name) => name.trim() !== '')
    .map((name) => ({ id: uuidv7(), name }));
  try {
    const { token } = await $fetch('/api/trips', {
      method: 'POST',
      body: { id, name: state.name, currency: state.currency, participants },
    });
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
            :placeholder="$t('trip.create.namePlaceholder', { year: new Date().getFullYear() })"
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
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ $t('participants.title') }}</legend>
          <p class="text-sm text-muted">{{ $t('trip.create.participantsHelp') }}</p>
          <UFormField
            v-for="(_, index) in state.participants"
            :key="index"
            :name="`participants.${index}`"
            :label="$t('trip.create.participant', { number: index + 1 })"
          >
            <div class="flex gap-2">
              <UInput
                v-model="state.participants[index]"
                :placeholder="$t('participants.namePlaceholder')"
                class="grow"
              />
              <UButton
                v-if="state.participants.length > 1"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                :aria-label="$t('trip.create.removeParticipant')"
                @click="state.participants.splice(index, 1)"
              />
            </div>
          </UFormField>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            :label="$t('trip.create.addParticipant')"
            @click="state.participants.push('')"
          />
        </fieldset>
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
