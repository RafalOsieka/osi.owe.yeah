<script setup lang="ts">
import { TRIP_TOKEN_HEADER, type Participant } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

// A Trip link is `/trips/<id>#<token>`: the token in the fragment is the only credential
// (ADR 0001) and is sent to the API in a header.
const route = useRoute();
const { t } = useI18n();
const deviceTrips = useDeviceTrips();

const tripId = String(route.params.id);
const token = route.hash.slice(1);
const headers = { [TRIP_TOKEN_HEADER]: token };
const {
  data: trip,
  error,
  refresh,
} = await useFetch(`/api/trips/${tripId}`, { headers, immediate: token !== '' });

// Only a refused token means the link is bad; any other failure (e.g. no signal) may pass.
const invalidLink = computed(() => token === '' || error.value?.statusCode === 401);

// Every Trip opened on this device is listed in My Trips with its Claim.
watch(trip, (opened) => opened && deviceTrips.remember(opened, token), { immediate: true });

const claim = computed(() => deviceTrips.find(tripId)?.claim ?? null);
// "Who are you?" is asked on first open, and again whenever the user changes their Claim.
const changingClaim = ref(false);
const askWhoYouAre = computed(() => claim.value === null || changingClaim.value);
const addFailed = ref(false);

function isClaimed(participant: Participant): boolean {
  return participant.id === claim.value?.id;
}

function claimParticipant(participant: Participant): void {
  deviceTrips.claim(tripId, participant);
  changingClaim.value = false;
}

async function addParticipant(name: string): Promise<Participant | undefined> {
  addFailed.value = false;
  const participant: Participant = { id: uuidv7(), name };
  try {
    await $fetch(`/api/trips/${tripId}/participants`, {
      method: 'POST',
      headers,
      body: participant,
    });
    await refresh();
    return participant;
  } catch {
    addFailed.value = true;
    return undefined;
  }
}

// "Add me": create a Participant and Claim it in one step.
async function addMe(name: string): Promise<void> {
  const participant = await addParticipant(name);
  if (participant) claimParticipant(participant);
}

useHead({ title: () => trip.value?.name ?? t('trip.invalidLink') });
</script>

<template>
  <UPage>
    <template v-if="trip">
      <UPageHeader
        :title="trip.name"
        :description="$t('trip.currency', { currency: trip.currency })"
      />
      <UPageBody class="space-y-6">
        <UAlert
          v-if="addFailed"
          color="error"
          icon="i-lucide-circle-alert"
          :title="$t('participants.addFailed')"
        />
        <WhoAreYou
          v-if="askWhoYouAre"
          :participants="trip.participants"
          :current="claim"
          @claim="claimParticipant"
          @add-me="addMe"
        />
        <div v-else class="flex items-center gap-2">
          <span>{{ $t('claim.youAre', { name: claim?.name }) }}</span>
          <UButton variant="link" :label="$t('claim.change')" @click="changingClaim = true" />
        </div>

        <section class="space-y-3">
          <h2 class="text-lg font-semibold">{{ $t('participants.title') }}</h2>
          <ul class="flex flex-wrap gap-2">
            <li v-for="participant in trip.participants" :key="participant.id">
              <UBadge
                :label="participant.name"
                :color="isClaimed(participant) ? 'primary' : 'neutral'"
                :variant="isClaimed(participant) ? 'solid' : 'outline'"
                size="lg"
              />
            </li>
          </ul>
          <ParticipantNameForm
            :label="$t('participants.new')"
            :submit-label="$t('participants.add')"
            @submit="addParticipant"
          />
        </section>
      </UPageBody>
    </template>
    <UPageBody v-else-if="invalidLink">
      <UEmpty
        icon="i-lucide-link-2-off"
        :title="$t('trip.invalidLink')"
        :description="$t('trip.invalidLinkHelp')"
      />
    </UPageBody>
    <UPageBody v-else>
      <UEmpty icon="i-lucide-cloud-off" :title="$t('trip.loadFailed')" />
    </UPageBody>
  </UPage>
</template>
