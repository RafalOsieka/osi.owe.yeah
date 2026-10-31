<script setup lang="ts">
import {
  TRIP_TOKEN_HEADER,
  type Expense,
  type ExpenseChange,
  type Participant,
  type StoredExpense,
} from '@osi/owe-yeah-domain';
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

// Each form keeps its id until an add succeeds, so a retry after a lost response is the
// same addition (the server keeps the last name sent) rather than a second Participant.
const pendingIds = { add: uuidv7(), addMe: uuidv7() };

async function addParticipant(
  name: string,
  form: keyof typeof pendingIds = 'add',
): Promise<Participant | undefined> {
  addFailed.value = false;
  const participant: Participant = { id: pendingIds[form], name };
  try {
    await $fetch(`/api/trips/${tripId}/participants`, {
      method: 'POST',
      headers,
      body: participant,
    });
    pendingIds[form] = uuidv7();
    await refresh();
    return participant;
  } catch {
    addFailed.value = true;
    return undefined;
  }
}

// "Add me": create a Participant and Claim it in one step.
async function addMe(name: string): Promise<void> {
  const participant = await addParticipant(name, 'addMe');
  if (participant) claimParticipant(participant);
}

// The Expense form: `null` when closed, `{ expense: null }` for a new Expense.
const editing = ref<{ expense: StoredExpense | null } | null>(null);
const formOpen = computed({
  get: () => editing.value !== null,
  set: (open) => {
    if (!open) editing.value = null;
  },
});
// Why the last save was refused, shown in the form; the Expense itself stays as it was.
const saveRefusals = ref<string[]>([]);
watch(editing, () => (saveRefusals.value = []));

// A resend of the very same change keeps its id, so a lost response is not applied twice.
let pendingChange: { key: string; id: string } | undefined;

function changeFor(expense: Expense, baseVersion: number | null): ExpenseChange {
  const key = JSON.stringify({ expense, baseVersion });
  if (pendingChange?.key !== key) pendingChange = { key, id: uuidv7() };
  return { id: pendingChange.id, baseVersion, expense };
}

// Sends the Expense's full new state through the sync push. Until the offline outbox
// arrives, this needs a connection.
async function saveExpense(expense: Expense): Promise<void> {
  saveRefusals.value = [];
  const change = changeFor(expense, editing.value?.expense?.version ?? null);
  const result = await $fetch(`/api/trips/${tripId}/push`, {
    method: 'POST',
    headers,
    body: { changes: [change] },
  }).then(
    ({ results }) => results[0],
    () => null,
  );
  if (result === null) {
    saveRefusals.value = [t('expense.saveFailed')];
    return;
  }

  if (result?.status === 'accepted') {
    pendingChange = undefined;
    editing.value = null;
  } else if (result?.status === 'conflict') {
    saveRefusals.value = [t('expense.refused.conflict')];
  } else if (result?.status === 'rejected') {
    saveRefusals.value = result.problems.map((problem) => t(`expense.refused.${problem}`));
  }
  await refresh();
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
          @cancel="changingClaim = false"
        />
        <div v-else class="flex items-center gap-2">
          <span>{{ $t('claim.youAre', { name: claim?.name }) }}</span>
          <UButton variant="link" :label="$t('claim.change')" @click="changingClaim = true" />
        </div>

        <section class="space-y-3" aria-labelledby="expenses-heading">
          <div class="flex items-center justify-between gap-2">
            <h2 id="expenses-heading" class="text-lg font-semibold">{{ $t('expense.list') }}</h2>
            <UButton
              icon="i-lucide-plus"
              :label="$t('expense.add')"
              :disabled="trip.participants.length === 0"
              @click="editing = { expense: null }"
            />
          </div>
          <ExpenseList
            v-if="trip.expenses.length > 0"
            :expenses="trip.expenses"
            :participants="trip.participants"
            @open="editing = { expense: $event }"
          />
          <p v-else class="text-sm text-muted">{{ $t('expense.empty') }}</p>
        </section>

        <section class="space-y-3" aria-labelledby="balances-heading">
          <h2 id="balances-heading" class="text-lg font-semibold">{{ $t('balances.title') }}</h2>
          <BalancesTable :trip="trip" :claim-id="claim?.id" />
        </section>

        <UModal
          v-model:open="formOpen"
          :title="editing?.expense ? $t('expense.edit') : $t('expense.new')"
        >
          <template #body>
            <ExpenseForm
              :trip="trip"
              :expense="editing?.expense"
              :claim-id="claim?.id"
              @submit="saveExpense"
            >
              <UAlert
                v-if="saveRefusals.length > 0"
                color="error"
                icon="i-lucide-circle-alert"
                :title="$t('expense.refused.title')"
                :description="saveRefusals.join(' ')"
              />
            </ExpenseForm>
          </template>
        </UModal>

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
            @submit="addParticipant($event)"
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
