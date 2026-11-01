<script setup lang="ts">
import { v7 as uuidv7 } from 'uuid';

// The Trip tab: everything about the Trip that is not money. For now its Participants, who
// this device says it is, and Recently deleted.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim, addParticipant, askWhoYouAre } = useOpenTrip();

const adding = ref(false);
useCloseOnBack(adding);

async function add(name: string): Promise<void> {
  await addParticipant({ id: uuidv7(), name });
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

    <section aria-labelledby="this-trip-heading" class="mt-6">
      <h2 id="this-trip-heading" class="text-xs font-semibold tracking-wide text-muted uppercase">
        {{ $t('trip.settings.thisTrip') }}
      </h2>
      <NuxtLink
        :to="`/trips/${trip.id}/deleted`"
        class="flex w-full items-center gap-3 border-b border-default py-2.5"
      >
        <span class="min-w-0 flex-1">{{ $t('deleted.title') }}</span>
        <UIcon name="i-lucide-chevron-right" class="size-5 text-dimmed" />
      </NuxtLink>
    </section>

    <UDrawer v-model:open="adding" :title="$t('participants.addParticipant')">
      <template #body>
        <ParticipantNameForm
          :label="$t('participants.name')"
          :submit-label="$t('participants.add')"
          @submit="add"
        />
      </template>
    </UDrawer>
  </NuxtLayout>
</template>
