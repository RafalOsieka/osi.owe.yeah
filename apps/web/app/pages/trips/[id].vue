<script setup lang="ts">
import { TRIP_TOKEN_HEADER, type Participant, type TripSnapshot } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

// Opens a Trip for its tabs: loads it once, and asks "Who are you?" when needed.
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const deviceTrips = useDeviceTrips();

// The Trip link `/trips/<id>#<token>` is only needed to join (ADR 0001): its token is kept
// with the Trip on this device and the URL loses it. Every request takes the token from
// the device, so a device that doesn't know the Trip can't open it without the link.
const tripId = String(route.params.id);
const linkToken = route.hash.slice(1);
const known = deviceTrips.find(tripId);
const token = linkToken || known?.token || '';
const headers = { [TRIP_TOKEN_HEADER]: token };

const { data, error, refresh } = await useFetch(`/api/trips/${tripId}`, {
  headers,
  immediate: token !== '',
});

// Only a refused token means the link is bad; any other failure (e.g. no signal) may pass.
const invalidLink = computed(() => token === '' || error.value?.statusCode === 401);

// The last Trip pulled, kept when a later pull fails, so the tabs never vanish under the
// user. Never cleared once set.
const snapshot = shallowRef<TripSnapshot>();
watch(
  data,
  (pulled) => {
    if (!pulled) return;
    snapshot.value = pulled;
    deviceTrips.remember(pulled, token);
  },
  { immediate: true },
);

const claim = computed(() => deviceTrips.find(tripId)?.claim ?? null);
const whoAreYouOpen = ref(false);
useCloseOnBack(whoAreYouOpen);

onMounted(async () => {
  if (!snapshot.value) return;
  if (linkToken) await router.replace({ path: route.path, query: route.query });
  // Asked the first time this device opens the Trip; after "Just looking" only on request.
  // Opened after the URL change: an open sheet cancels navigation.
  if (!known && claim.value === null) whoAreYouOpen.value = true;
});

function claimParticipant(participant: Participant): void {
  deviceTrips.claim(tripId, participant);
  whoAreYouOpen.value = false;
}

async function addParticipant(participant: Participant): Promise<boolean> {
  try {
    await $fetch(`/api/trips/${tripId}/participants`, {
      method: 'POST',
      headers,
      body: participant,
    });
  } catch {
    return false;
  }
  await refresh();
  return true;
}

// "Add me" keeps its id until it succeeds, so a retry is the same addition.
let addMeId = uuidv7();
const addMeFailed = ref(false);
watch(whoAreYouOpen, () => (addMeFailed.value = false));

async function addMe(name: string): Promise<void> {
  const participant: Participant = { id: addMeId, name };
  addMeFailed.value = !(await addParticipant(participant));
  if (addMeFailed.value) return;
  addMeId = uuidv7();
  claimParticipant(participant);
}

provideOpenTrip({
  // Only read by the tabs, which render once a Trip has been pulled.
  trip: computed(() => snapshot.value!),
  claim,
  headers,
  refresh,
  addParticipant,
  askWhoYouAre: () => (whoAreYouOpen.value = true),
});

useHead({ title: () => snapshot.value?.name ?? t('trip.invalidLink') });
</script>

<template>
  <div>
    <template v-if="snapshot">
      <NuxtPage />
      <WhoAreYou
        v-model:open="whoAreYouOpen"
        :participants="snapshot.participants"
        :current="claim"
        :add-failed="addMeFailed"
        @claim="claimParticipant"
        @add-me="addMe"
      />
    </template>
    <NuxtLayout v-else name="default">
      <UEmpty
        v-if="invalidLink"
        icon="i-lucide-link-2-off"
        :title="$t('trip.invalidLink')"
        :description="$t('trip.invalidLinkHelp')"
      />
      <UEmpty v-else icon="i-lucide-cloud-off" :title="$t('trip.loadFailed')" />
    </NuxtLayout>
  </div>
</template>
