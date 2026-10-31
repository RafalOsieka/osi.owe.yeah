<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';

// The "Who are you?" sheet: the device picks one of the Trip's Participants as its Claim,
// or uses "Add me" to create a new Participant and Claim it in one step. Closing it ("Just
// looking", or "Cancel" with a Claim) changes nothing.
defineProps<{
  participants: readonly Participant[];
  current: Participant | null;
  /** The last "Add me" could not be sent. */
  addFailed: boolean;
}>();
const emit = defineEmits<{
  claim: [participant: Participant];
  addMe: [name: string];
}>();
const open = defineModel<boolean>('open', { required: true });
</script>

<template>
  <UDrawer v-model:open="open" :title="$t('claim.title')" :description="$t('claim.help')">
    <template #body>
      <div class="space-y-4">
        <ul v-if="participants.length > 0" class="grid grid-cols-2 gap-2">
          <li v-for="participant in participants" :key="participant.id" class="min-w-0">
            <UButton
              :variant="participant.id === current?.id ? 'soft' : 'outline'"
              color="neutral"
              size="lg"
              block
              class="justify-start"
              @click="emit('claim', participant)"
            >
              <ParticipantAvatar :participant="participant" size="xs" />
              <span class="truncate">{{ participant.name }}</span>
            </UButton>
          </li>
        </ul>
        <ParticipantNameForm
          :label="$t('claim.notListed')"
          :submit-label="$t('claim.addMe')"
          @submit="emit('addMe', $event)"
        />
        <UAlert
          v-if="addFailed"
          color="error"
          icon="i-lucide-circle-alert"
          :title="$t('participants.addFailed')"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        variant="ghost"
        color="neutral"
        block
        :label="current ? $t('claim.cancel') : $t('claim.justLooking')"
        @click="open = false"
      />
    </template>
  </UDrawer>
</template>
