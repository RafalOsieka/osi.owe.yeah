<script setup lang="ts">
import { expensesReferencing, type Participant } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

// The Trip tab: everything about the Trip that is not money. Its Participants (tap one to
// remove them, refused while an Expense references them) with Add Participant and Invite,
// who this device says it is and its notifications, the Trip's name and Trip currency, Recently deleted, forgetting the Trip on
// this device, and the privacy notice and the terms. Notifications need a Claim first; on iOS
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
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated cursor-pointer"
              @click="pick(participant)"
            >
              <ParticipantAvatar :participant="participant" size="md" />
              <span class="min-w-0 flex-1 wrap-anywhere text-highlighted">
                {{ participant.name }}
                <UBadge
                  v-if="participant.id === claim?.id"
                  :label="$t('participants.you')"
                  variant="subtle"
                  size="sm"
                  class="ms-1 align-middle"
                />
              </span>
            </button>
          </li>
        </ul>
        <div class="divide-y divide-default border-t border-default">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start font-medium text-primary transition-colors hover:bg-elevated/60 active:bg-elevated"
            @click="adding = true"
          >
            <span class="grid size-8 place-items-center rounded-full bg-primary/10">
              <UIcon name="i-lucide-user-plus" class="size-4" />
            </span>
            {{ $t('participants.addParticipant') }}
          </button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start font-medium text-primary transition-colors hover:bg-elevated/60 active:bg-elevated"
            @click="invite"
          >
            <span class="grid size-8 place-items-center rounded-full bg-primary/10">
              <UIcon name="i-lucide-share-2" class="size-4" />
            </span>
            {{ $t('invite.action') }}
          </button>
        </div>
      </div>
    </section>

    <section aria-labelledby="device-heading" class="mt-7">
      <h2 id="device-heading" class="section-heading">
        {{ $t('trip.settings.onThisDevice') }}
      </h2>
      <div class="card divide-y divide-default overflow-hidden">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated cursor-pointer"
          @click="askWhoYouAre"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('claim.whoYouAre') }}</span>
            <span class="block text-sm text-muted wrap-anywhere">
              {{ claim?.name ?? $t('claim.nobody') }}
            </span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
        </button>
        <div
          v-if="support === 'homeScreen'"
          class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('notifications.title') }}</span>
            <span class="block text-sm text-muted">{{ $t('notifications.homeScreen') }}</span>
          </span>
        </div>
        <button
          v-else-if="!claim"
          type="button"
          class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated cursor-pointer"
          @click="askWhoYouAre"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('notifications.title') }}</span>
            <span class="block text-sm text-muted">{{ $t('notifications.pickFirst') }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
        </button>
        <NuxtLink
          v-else
          :to="`/trips/${trip.id}/notifications`"
          class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('notifications.title') }}</span>
            <span class="block text-sm text-muted">{{ notificationsState }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
        </NuxtLink>
      </div>
    </section>

    <section aria-labelledby="this-trip-heading" class="mt-7">
      <h2 id="this-trip-heading" class="section-heading">
        {{ $t('trip.settings.thisTrip') }}
      </h2>
      <div class="card divide-y divide-default overflow-hidden">
        <NuxtLink
          :to="`/trips/${trip.id}/details`"
          class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">{{ $t('trip.details.title') }}</span>
            <span class="block text-sm text-muted wrap-anywhere">
              {{ $t('trip.details.row', { name: trip.name, currency: trip.currency }) }}
            </span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
        </NuxtLink>
        <NuxtLink
          :to="`/trips/${trip.id}/deleted`"
          class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated"
        >
          <span class="min-w-0 flex-1 text-highlighted">{{ $t('deleted.title') }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
        </NuxtLink>
      </div>
      <div class="card mt-4 overflow-hidden">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated cursor-pointer font-medium text-error"
          @click="forgetting = true"
        >
          <UIcon name="i-lucide-log-out" class="size-5 shrink-0" />
          {{ $t('trip.forget.title') }}
        </button>
      </div>
    </section>

    <LegalLinks class="mt-10" />

    <UDrawer v-model:open="adding" :title="$t('participants.addParticipant')">
      <template #body>
        <ParticipantNameForm
          :label="$t('participants.name')"
          :submit-label="$t('participants.add')"
          @submit="add"
        />
      </template>
    </UDrawer>

    <UDrawer v-model:open="pickedOpen" :title="picked?.name ?? ''">
      <template #body>
        <p v-if="referencing > 0" class="text-sm">
          {{ $t('participants.referenced', referencing, { named: { name: picked?.name ?? '' } }) }}
        </p>
        <p v-else class="text-sm text-muted">{{ $t('participants.removeHelp') }}</p>
      </template>
      <template #footer>
        <UButton
          v-if="referencing === 0"
          color="error"
          block
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
    </UDrawer>

    <UModal
      v-model:open="forgetting"
      :title="$t('trip.forget.title')"
      :description="$t('trip.forget.help', { name: trip.name })"
    >
      <template #body>
        <UAlert
          v-if="unsynced > 0"
          color="warning"
          variant="subtle"
          icon="i-lucide-cloud-off"
          :title="$t('trip.forget.unsynced', unsynced)"
        />
        <p class="text-sm" :class="{ 'mt-3': unsynced > 0 }">{{ $t('trip.forget.linkNeeded') }}</p>
      </template>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton
            color="error"
            block
            :label="unsynced > 0 ? $t('trip.forget.anyway', unsynced) : $t('trip.forget.confirm')"
            @click="forgetTrip"
          />
          <UButton
            variant="ghost"
            color="neutral"
            block
            :label="$t('claim.cancel')"
            @click="forgetting = false"
          />
        </div>
      </template>
    </UModal>
  </NuxtLayout>
</template>
