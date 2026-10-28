<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';

// "Who are you?": the device picks one of the Trip's Participants as its Claim, or uses
// "Add me" to create a new Participant and Claim it in one step. With a current Claim,
// it can also be cancelled, keeping that Claim.
defineProps<{ participants: readonly Participant[]; current?: Participant | null }>();
const emit = defineEmits<{
  claim: [participant: Participant];
  addMe: [name: string];
  cancel: [];
}>();
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-lg font-semibold">{{ $t('claim.title') }}</h2>
      <p class="text-sm text-muted">{{ $t('claim.help') }}</p>
    </template>
    <div class="space-y-4">
      <div v-if="participants.length > 0" class="flex flex-wrap gap-2">
        <UButton
          v-for="participant in participants"
          :key="participant.id"
          :label="participant.name"
          :variant="participant.id === current?.id ? 'solid' : 'outline'"
          icon="i-lucide-user"
          @click="emit('claim', participant)"
        />
      </div>
      <ParticipantNameForm
        :label="$t('claim.notListed')"
        :submit-label="$t('claim.addMe')"
        @submit="emit('addMe', $event)"
      />
    </div>
    <template v-if="current" #footer>
      <UButton
        variant="ghost"
        color="neutral"
        :label="$t('claim.cancel')"
        @click="emit('cancel')"
      />
    </template>
  </UCard>
</template>
