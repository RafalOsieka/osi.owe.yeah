<script setup lang="ts">
import type { Expense, Participant, Trip } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { NOTIFICATIONS_OFF, type BrowserSubscription, type ExpenseBase } from '~/sync/db';

// Opens a Trip for its tabs and Expense pages from the device, joins it from a Trip link,
// saves changes on the device and syncs them, and asks "Who are you?" when needed: also
// when sync finds this device's Participant removed by someone else. A Claim made there is
// followed by the offer of notifications, once per Trip (#41). Holds Invite, opened from the
// Trip header, the Trip tab and the empty Expenses tab.
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const device = useDevice();

// The Trip link `/trips/<id>#<token>` is only needed to join (ADR 0001): its token is kept
// with the Trip on this device and the URL loses it. A device that doesn't know the Trip
// can't open it without the link.
const tripId = String(route.params.id);
const linkToken = route.hash.slice(1);
const known = await device.read(tripId);
// A link with a token the device doesn't have yet joins, or rejoins, the Trip.
const joined =
  linkToken && linkToken !== known?.deviceTrip.token
    ? await device.joinTrip(tripId, linkToken)
    : null;
if (known) {
  void device.open(tripId);
  void device.sync(tripId);
}

const view = useLiveQuery(() => device.read(tripId));
const trip = computed(() => view.value?.local);
const claim = computed(() => view.value?.deviceTrip.claim ?? null);
// Nothing to show: the Trip isn't on the device and its link doesn't work, or couldn't be
// tried (e.g. no signal); or it is, but has never been pulled.
const onDevice = known !== undefined || joined === 'joined';
const invalidLink = !onDevice && joined !== 'unreachable';
const nothingToShow = computed(() => !onDevice || view.value?.local === null);

const whoAreYouOpen = ref(false);
useCloseOnBack(whoAreYouOpen);
// Whether the sheet shows the offer of notifications that follows a Claim.
const offering = ref(false);
watch(whoAreYouOpen, (open) => {
  if (!open) offering.value = false;
});
const { support } = usePushNotifications();
const notifications = computed(() => view.value?.deviceTrip.notifications ?? NOTIFICATIONS_OFF);

const inviteOpen = ref(false);
useCloseOnBack(inviteOpen);
// The Trip link to pass on, once the server has the Trip (it has a snapshot): before that,
// the link would open nothing.
const tripLink = computed(() => {
  const deviceTrip = view.value?.deviceTrip;
  if (!deviceTrip?.snapshot) return null;
  return new URL(`/trips/${tripId}#${deviceTrip.token}`, location.origin).href;
});
// Who this device was before someone else removed them, while it is asked again.
const removedClaim = ref<Participant | null>(null);

onMounted(async () => {
  if (!onDevice) return;
  if (linkToken) await router.replace({ path: route.path, query: route.query });
  // Asked the first time this device opens the Trip; after "Just looking" only on request.
  // Opened after the URL change: an open sheet cancels navigation.
  if (!known && claim.value === null) whoAreYouOpen.value = true;
  watch(
    () => view.value?.deviceTrip.notices.find(({ kind }) => kind === 'claimRemoved'),
    (notice) => {
      if (notice?.kind !== 'claimRemoved') return;
      removedClaim.value = notice.participant;
      whoAreYouOpen.value = true;
      void device.dismissNotice(tripId, notice.id);
    },
    { immediate: true },
  );
});

// Offered once where it can be turned on, and on iOS outside the installed app with the Home
// Screen hint; not where the person blocked notifications (the Trip tab says how to unblock
// them). Shown, it counts as "Not now" until turned on.
async function claimParticipant(participant: Participant): Promise<void> {
  await device.claim(tripId, participant);
  // The server's push subscription follows the Claim.
  if (notifications.value.subscription) void device.sync(tripId);
  removedClaim.value = null;
  if (!notifications.value.offered && (support.value === 'available' || support.value === 'homeScreen')) {
    offering.value = true;
    await device.declineNotifications(tripId);
  } else {
    whoAreYouOpen.value = false;
  }
}

async function turnOnNotifications(subscription: BrowserSubscription): Promise<void> {
  await device.turnOnNotifications(tripId, subscription);
  void device.sync(tripId);
}

async function turnOffNotifications(): Promise<void> {
  await device.turnOffNotifications(tripId);
  void device.sync(tripId);
}

async function subscribedFromOffer(subscription: BrowserSubscription): Promise<void> {
  await turnOnNotifications(subscription);
  whoAreYouOpen.value = false;
}

async function addParticipant(participant: Participant): Promise<void> {
  await device.addParticipant(tripId, participant);
  void device.sync(tripId);
}

async function addMe(name: string): Promise<void> {
  const participant: Participant = { id: uuidv7(), name };
  await addParticipant(participant);
  await claimParticipant(participant);
}

async function saveExpense(expense: Expense, base: ExpenseBase) {
  const problems = await device.saveExpense(tripId, expense, base);
  if (problems.length === 0) void device.sync(tripId);
  return problems;
}

async function deleteExpense(expense: Expense, base: ExpenseBase) {
  const problems = await device.deleteExpense(tripId, expense, base);
  if (problems.length === 0) void device.sync(tripId);
  return problems;
}

async function removeParticipant(participant: Participant): Promise<number> {
  const referencing = await device.removeParticipant(tripId, participant);
  if (referencing === 0) void device.sync(tripId);
  return referencing;
}

async function saveTripDetails(details: Omit<Trip, 'id'>): Promise<void> {
  await device.saveTripDetails(tripId, details);
  void device.sync(tripId);
}

// My Trips first, so nothing on screen still reads the Trip as it goes.
async function forget(): Promise<void> {
  await navigateTo('/', { replace: true });
  await device.forgetTrip(tripId);
}

async function keepMine(expenseId: string): Promise<void> {
  await device.keepMine(tripId, expenseId);
  void device.sync(tripId);
}

provideOpenTrip({
  // Only read by the pages under it, which render once there is a Trip to show.
  trip: computed(() => trip.value!),
  claim,
  lastCurrency: computed(() => view.value?.deviceTrip.lastCurrency ?? null),
  unsynced: computed(() => view.value?.unsynced ?? 0),
  everyone: computed(() => [
    ...(trip.value?.participants ?? []),
    ...(trip.value?.removedParticipants ?? []),
  ]),
  notices: computed(() => view.value?.deviceTrip.notices ?? []),
  dismissNotice: (noticeId) => device.dismissNotice(tripId, noticeId),
  sync: () => device.sync(tripId),
  addParticipant,
  removeParticipant,
  saveTripDetails,
  forget,
  saveExpense,
  deleteExpense,
  revisions: (expenseId) => device.revisions(tripId, expenseId),
  keepMine,
  discardChanges: (expenseId) => device.discardChanges(tripId, expenseId),
  notifications,
  turnOnNotifications,
  turnOffNotifications,
  askWhoYouAre: () => (whoAreYouOpen.value = true),
  invite: () => (inviteOpen.value = true),
});

useHead({ title: () => trip.value?.name ?? t('trip.invalidLink') });
</script>

<template>
  <div>
    <template v-if="trip">
      <NuxtPage />
      <WhoAreYou
        v-model:open="whoAreYouOpen"
        :participants="trip.participants"
        :current="claim"
        :removed="removedClaim"
        :offer-for="offering ? trip.name : null"
        @claim="claimParticipant"
        @add-me="addMe"
        @subscribed="subscribedFromOffer"
      />
      <InviteSheet v-model:open="inviteOpen" :trip-name="trip.name" :link="tripLink" />
    </template>
    <NuxtLayout v-else-if="nothingToShow" name="default">
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
