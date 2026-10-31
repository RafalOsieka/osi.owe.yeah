<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

// The Trip tab: everything about the Trip that is not money. For now its Participants,
// and who this device says it is.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim, addParticipant, askWhoYouAre } = useOpenTrip();

const adding = ref(false);
useCloseOnBack(adding);
const addFailed = ref(false);
watch(adding, () => (addFailed.value = false));

// The form keeps its id until an add succeeds, so a retry after a lost response is the
// same addition (the server keeps the last name sent) rather than a second Participant.
let pendingId = uuidv7();

async function add(name: string): Promise<void> {
  const participant: Participant = { id: pendingId, name };
  addFailed.value = !(await addParticipant(participant));
  if (addFailed.value) return;
  pendingId = uuidv7();
  adding.value = false;
}
</script>

<template>
  <NuxtLayout name="trip">
    <section aria-labelledby="participants-heading">
      <h2
        id="participants-heading"
        class="mt-2 text-xs font-semibold tracking-wide text-muted uppercase"
      >
        {{ $t('participants.title') }}
      </h2>
      <ul>
        <li
          v-for="participant in trip.participants"
          :key="participant.id"
          class="flex items-center gap-3 border-b border-default py-2.5"
        >
          <ParticipantAvatar :participant="participant" />
          <span class="min-w-0 flex-1 wrap-anywhere">{{ participant.name }}</span>
          <UBadge
            v-if="participant.id === claim?.id"
            :label="$t('participants.you')"
            variant="soft"
            size="sm"
          />
        </li>
      </ul>
      <UButton
        variant="ghost"
        icon="i-lucide-plus"
        :label="$t('participants.addParticipant')"
        class="-mx-2.5 mt-1"
        @click="adding = true"
      />
    </section>

    <section aria-labelledby="device-heading" class="mt-6">
      <h2 id="device-heading" class="text-xs font-semibold tracking-wide text-muted uppercase">
        {{ $t('trip.settings.onThisDevice') }}
      </h2>
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 border-b border-default py-2.5 text-start"
        @click="askWhoYouAre"
      >
        <span class="min-w-0 flex-1">
          <span class="block">{{ $t('claim.whoYouAre') }}</span>
          <span class="block text-sm text-muted wrap-anywhere">
            {{ claim?.name ?? $t('claim.nobody') }}
          </span>
        </span>
        <UIcon name="i-lucide-chevron-right" class="size-5 text-dimmed" />
      </button>
    </section>

    <UDrawer v-model:open="adding" :title="$t('participants.addParticipant')">
      <template #body>
        <div class="space-y-4">
          <ParticipantNameForm
            :label="$t('participants.name')"
            :submit-label="$t('participants.add')"
            @submit="add"
          />
          <UAlert
            v-if="addFailed"
            color="error"
            icon="i-lucide-circle-alert"
            :title="$t('participants.addFailed')"
          />
        </div>
      </template>
    </UDrawer>
  </NuxtLayout>
</template>
