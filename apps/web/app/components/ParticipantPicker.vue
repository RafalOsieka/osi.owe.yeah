<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';

// Picks one Participant as avatar chips under a label, e.g. "Paid by". Sits inside a
// `UFormField`; `name` groups the chips' radios. The parent may refuse a pick by not taking
// it into its model; the radios then go back to the pick that stands.
const { participants, label, name } = defineProps<{
  participants: readonly Participant[];
  label: string;
  name: string;
}>();
const picked = defineModel<string>({ required: true });

const labelId = useId();
const group = useTemplateRef('group');

async function pick(participantId: string): Promise<void> {
  picked.value = participantId;
  await nextTick();
  if (picked.value === participantId) return;
  // The browser has already moved the check; nothing re-renders when the model stays.
  group.value?.querySelectorAll('input').forEach((input, index) => {
    input.checked = participants[index]?.id === picked.value;
  });
}
</script>

<template>
  <div ref="group" role="group" :aria-labelledby="labelId">
    <p :id="labelId" class="mb-2 text-sm font-medium text-highlighted">{{ label }}</p>
    <div class="flex flex-wrap gap-2">
      <ParticipantChip
        v-for="participant in participants"
        :key="participant.id"
        :participant="participant"
        type="radio"
        :name="name"
        :checked="picked === participant.id"
        @update:checked="pick(participant.id)"
      />
    </div>
  </div>
</template>
