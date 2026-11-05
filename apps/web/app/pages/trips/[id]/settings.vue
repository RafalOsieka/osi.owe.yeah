<script setup lang="ts">
import { expensesReferencing, type Participant } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

// The Trip tab: everything about the Trip that is not money. Its Participants (tap one to
// remove them, refused while an Expense references them) with Add Participant and Invite;
// the Trip's name and Trip currency, and Recently deleted; then what is only this device's:
// who it says it is, its notifications, and forgetting the Trip (last, quiet, and asked
// first); and the privacy notice and the terms. Notifications need a Claim first; on iOS
// outside the installed app, the row says to add the app to the Home Screen instead.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const {
  trip,
  claim,
  unsynced,
  notifications,
  addParticipant,
  removeParticipant,
  askWhoYouAre,
  invite,
  forget,
} = useOpenTrip();
const { t } = useI18n();
const { support } = usePushNotifications();
const notificationsState = computed(() => {
  if (notifications.value.subscription) return t('notifications.on');
  return support.value === 'denied' ? t('notifications.blocked') : t('notifications.off');
});

const adding = ref(false);
useCloseOnBack(adding);

async function add(name: string): Promise<void> {
  await addParticipant({ id: uuidv7(), name });
  adding.value = false;
}

// The Participant whose sheet is open, and how many Expenses reference them.
// Shallow: the Participant goes to the device store as it is, not as a reactive proxy.
const picked = shallowRef<Participant | null>(null);
const pickedOpen = ref(false);
useCloseOnBack(pickedOpen);
const referencing = ref(0);

function pick(participant: Participant): void {
  picked.value = participant;
  referencing.value = expensesReferencing(trip.value.expenses, participant.id);
  pickedOpen.value = true;
}

async function remove(): Promise<void> {
  if (!picked.value) return;
  referencing.value = await removeParticipant(picked.value);
  if (referencing.value === 0) pickedOpen.value = false;
}

const forgetting = ref(false);
useCloseOnBack(forgetting);

// Closed first: while it is open, leaving the page only closes it.
async function forgetTrip(): Promise<void> {
  forgetting.value = false;
  await forget();
}

// A tappable row of a card, its chevron, and the compact actions under the Participants.
const row =
  'flex w-full min-h-14 cursor-pointer items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated';
const chevron = 'size-5 shrink-0 text-dimmed';
const action =
  'flex min-h-12 cursor-pointer items-center justify-center gap-2 px-3 font-medium text-primary transition-colors hover:bg-elevated/60 active:bg-elevated';
</script>

<template>
  <NuxtLayout name="trip">
    <section aria-labelledby="participants-heading">
      <h2 id="participants-heading" class="section-heading">
        {{ $t('participants.title') }}
      </h2>
      <div class="card overflow-hidden">
        <ul class="divide-y divide-default">
          <li v-for="participant in trip.participants" :key="participant.id">
            <button type="button" :class="row" @click="pick(participant)">
              <ParticipantAvatar :participant="participant" size="md" />
              <span class="min-w-0 flex-1 wrap-anywhere text-highlighted">
                {{ participant.name }}
                <YouBadge v-if="participant.id === claim?.id" />
              </span>
              <UIcon name="i-lucide-chevron-right" :class="chevron" />
            </button>
          </li>
        </ul>
        <!-- Two compact actions side by side, so they don't read as more people. -->
        <div class="grid grid-cols-2 divide-x divide-default border-t border-default">
          <button type="button" :class="action" @click="adding = true">
            <UIcon name="i-lucide-user-plus" class="size-5 shrink-0" />
            {{ $t('participants.addParticipant') }}
          </button>
          <button type="button" :class="action" @click="invite">
            <UIcon name="i-lucide-share-2" class="size-5 shrink-0" />
            {{ $t('invite.action') }}
          </button>
        </div>
      </div>
    </section>

    <section aria-labelledby="this-trip-heading" class="mt-7">
      <h2 id="this-trip-heading" class="section-heading">
        {{ $t('trip.settings.thisTrip') }}
      </h2>
      <div class="card divide-y divide-default overflow-hidden">
        <NuxtLink :to="`/trips/${trip.id}/details`" :class="row">
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('trip.details.title') }}</span>
            <span class="block text-sm text-muted wrap-anywhere">
              {{ $t('trip.details.row', { name: trip.name, currency: trip.currency }) }}
            </span>
          </span>
          <UIcon name="i-lucide-chevron-right" :class="chevron" />
        </NuxtLink>
        <NuxtLink :to="`/trips/${trip.id}/deleted`" :class="row">
          <span class="min-w-0 flex-1 text-highlighted">{{ $t('deleted.title') }}</span>
          <UIcon name="i-lucide-chevron-right" :class="chevron" />
        </NuxtLink>
      </div>
    </section>

    <section aria-labelledby="device-heading" class="mt-7">
      <h2 id="device-heading" class="section-heading">
        {{ $t('trip.settings.onThisDevice') }}
      </h2>
      <div class="card divide-y divide-default overflow-hidden">
        <button type="button" :class="row" @click="askWhoYouAre">
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('claim.whoYouAre') }}</span>
            <span class="block text-sm text-muted wrap-anywhere">
              {{ claim?.name ?? $t('claim.nobody') }}
            </span>
          </span>
          <UIcon name="i-lucide-chevron-right" :class="chevron" />
        </button>
        <div v-if="support === 'homeScreen'" class="flex min-h-14 w-full items-center px-4 py-3">
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('notifications.title') }}</span>
            <span class="block text-sm text-muted">{{ $t('notifications.homeScreen') }}</span>
          </span>
        </div>
        <button v-else-if="!claim" type="button" :class="row" @click="askWhoYouAre">
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('notifications.title') }}</span>
            <span class="block text-sm text-muted">{{ $t('notifications.pickFirst') }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" :class="chevron" />
        </button>
        <NuxtLink v-else :to="`/trips/${trip.id}/notifications`" :class="row">
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('notifications.title') }}</span>
            <span class="block text-sm text-muted">{{ notificationsState }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" :class="chevron" />
        </NuxtLink>
        <!-- Last and quiet, like any row: only the sheet's confirmation is red. -->
        <button type="button" :class="row" @click="forgetting = true">
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('trip.forget.title') }}</span>
            <span class="block text-sm text-muted">{{ $t('trip.forget.row') }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" :class="chevron" />
        </button>
      </div>
    </section>

    <LegalLinks class="mt-8" />

    <UDrawer
      v-model:open="adding"
      :title="$t('participants.addParticipant')"
      :description="$t('participants.addHelp')"
      :ui="{ description: 'text-pretty', footer: 'pb-2' }"
    >
      <template #body>
        <ParticipantNameForm
          :label="$t('participants.name')"
          :submit-label="$t('participants.add')"
          @submit="add"
        />
      </template>
      <template #footer>
        <UButton
          variant="ghost"
          color="neutral"
          block
          :label="$t('claim.cancel')"
          @click="adding = false"
        />
      </template>
    </UDrawer>

    <!-- The Participant's own sheet: their name, how many Expenses they are on, then what that
         means for removing them, right under the name as the sheet's description. -->
    <UDrawer v-model:open="pickedOpen" :ui="{ description: 'mt-3', footer: 'pt-2' }">
      <template #title>
        <span v-if="picked" class="flex items-center gap-3">
          <ParticipantAvatar :participant="picked" size="lg" />
          <span class="min-w-0 wrap-anywhere">{{ picked.name }}</span>
          <YouBadge v-if="picked.id === claim?.id" class="ms-0" />
        </span>
      </template>
      <template #description>
        <span class="block text-base text-highlighted">
          {{ $t('participants.onExpenses', referencing) }}
        </span>
        <span class="mt-1 block text-pretty">
          {{ referencing > 0 ? $t('participants.onExpensesHelp') : $t('participants.removeHelp') }}
        </span>
      </template>
      <template #footer>
        <template v-if="referencing === 0">
          <UButton
            color="error"
            block
            size="xl"
            icon="i-lucide-user-minus"
            :label="$t('participants.remove')"
            @click="remove"
          />
          <UButton
            variant="ghost"
            color="neutral"
            block
            :label="$t('claim.cancel')"
            @click="pickedOpen = false"
          />
        </template>
        <UButton
          v-else
          variant="soft"
          color="neutral"
          block
          size="xl"
          :label="$t('form.done')"
          @click="pickedOpen = false"
        />
      </template>
    </UDrawer>

    <UDrawer
      v-model:open="forgetting"
      :title="$t('trip.forget.title')"
      :description="$t('trip.forget.help', { name: trip.name })"
      :ui="{ description: 'text-pretty', footer: 'pb-2' }"
    >
      <template v-if="unsynced > 0" #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-cloud-off"
          :title="$t('trip.forget.unsynced', unsynced)"
        />
      </template>
      <template #footer>
        <UButton
          color="error"
          block
          size="xl"
          :label="unsynced > 0 ? $t('trip.forget.anyway', unsynced) : $t('trip.forget.confirm')"
          @click="forgetTrip"
        />
        <UButton
          variant="ghost"
          color="neutral"
          block
          :label="$t('trip.forget.keep')"
          @click="forgetting = false"
        />
      </template>
    </UDrawer>
  </NuxtLayout>
</template>
