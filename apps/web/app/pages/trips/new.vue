<script setup lang="ts">
import {
  PARTICIPANT_LIMIT,
  TRIP_CURRENCIES,
  participantNameSchema,
  tripNameSchema,
  tripWithParticipantsSchema,
  type Trip,
} from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import { v7 as uuidv7 } from 'uuid';

// New Trip: "Your name" is the first Participant and becomes this device's Claim, so the
// creator is never asked "Who are you?". The privacy notice and the terms are linked below the
// form, to read before typing names in.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { t } = useI18n();
const device = useDevice();

useHead({ title: () => t('trip.create.title') });

// Names as typed, one field each; blank "Who else is coming?" fields are left out.
type TripForm = Omit<Trip, 'id'> & { me: string; others: string[] };

const state = reactive<TripForm>({ name: '', currency: 'EUR', me: '', others: [''] });

const currencies = useCurrencyItems(TRIP_CURRENCIES);

// "Your name" and every other field, blank ones too, make as many Participants as a Trip can have.
const full = computed(() => 1 + state.others.length >= PARTICIPANT_LIMIT);

// The domain rules for names, worded for the form; the currency picker only offers valid ones.
function validate(trip: Partial<TripForm>): FormError[] {
  const errors: FormError[] = [];
  if (!tripNameSchema.safeParse(trip.name).success) {
    errors.push({ name: 'name', message: t('trip.create.nameInvalid') });
  }
  if (!participantNameSchema.safeParse(trip.me).success) {
    errors.push({ name: 'me', message: t('participants.nameInvalid') });
  }
  (trip.others ?? []).forEach((name, index) => {
    if (name.trim() !== '' && !participantNameSchema.safeParse(name).success) {
      errors.push({ name: `others.${index}`, message: t('participants.nameInvalid') });
    }
  });
  return errors;
}

// Created on the device, so it works offline; the Trip syncs by itself. The ids
// and the Trip link's token are generated here; the token is kept on the device with the
// Trip and never shown in the URL.
async function create(): Promise<void> {
  const me = { id: uuidv7(), name: state.me };
  const others = state.others
    .filter((name) => name.trim() !== '')
    .map((name) => ({ id: uuidv7(), name }));
  // Trims the names, as the server stores them.
  const trip = tripWithParticipantsSchema.parse({
    id: uuidv7(),
    name: state.name,
    currency: state.currency,
    participants: [me, ...others],
  });
  await device.createTrip(trip, newTripToken());
  // Replaced, so back from the Trip goes to My Trips rather than to this finished form.
  await navigateTo(`/trips/${trip.id}`, { replace: true });
}
</script>

<template>
  <NuxtLayout name="form" :title="$t('trip.create.title')" parent="/" close>
    <UForm id="new-trip" :state="state" :validate="validate" class="space-y-4" @submit="create">
      <div class="card space-y-4 p-4">
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
      </div>
      <div class="card space-y-4 p-4">
        <UFormField name="me" :label="$t('trip.create.me')" :help="$t('trip.create.meHelp')">
          <UInput
            v-model="state.me"
            :placeholder="$t('trip.create.mePlaceholder')"
            class="w-full"
          />
        </UFormField>
        <fieldset class="space-y-2">
          <legend class="mb-1.5 text-sm font-medium text-default">
            {{ $t('trip.create.others') }}
          </legend>
          <UFormField v-for="(_, index) in state.others" :key="index" :name="`others.${index}`">
            <!-- The remove button sits inside the field, so every field keeps one width. -->
            <UInput
              v-model="state.others[index]"
              :placeholder="$t('trip.create.othersPlaceholder')"
              :aria-label="$t('trip.create.participant', { number: index + 2 })"
              :ui="{ trailing: 'pe-0.5' }"
              class="w-full"
            >
              <template v-if="state.others.length > 1" #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="md"
                  icon="i-lucide-x"
                  class="text-dimmed hover:text-default"
                  :aria-label="$t('trip.create.removeParticipant')"
                  @click="state.others.splice(index, 1)"
                />
              </template>
            </UInput>
          </UFormField>
          <!-- Right under the fields it adds to, green like every other add, its "+" in line with
               the names typed in them. -->
          <UButton
            variant="ghost"
            icon="i-lucide-plus"
            :label="$t('trip.create.addParticipant')"
            class="-ms-1"
            :disabled="full"
            @click="state.others.push('')"
          />
          <p class="text-sm text-muted">
            {{ full ? $t('participants.limitReached') : $t('trip.create.othersHelp') }}
          </p>
        </fieldset>
      </div>
    </UForm>
    <LegalLinks class="mt-8" />

    <template #action>
      <UButton type="submit" form="new-trip" block size="xl" :label="$t('trip.create.submit')" />
    </template>
  </NuxtLayout>
</template>
