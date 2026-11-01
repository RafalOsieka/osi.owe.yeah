<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';

// Picks one Participant as avatar chips under a label, e.g. "Paid by". Sits inside a
// `UFormField`; `name` groups the chips' radios.
const { participants, label, name } = defineProps<{
  participants: readonly Participant[];
  label: string;
  name: string;
}>();
const picked = defineModel<string>({ required: true });

const labelId = useId();
</script>

<template>
  <div role="group" :aria-labelledby="labelId">
    <p :id="labelId" class="mb-1.5 text-sm font-medium">{{ label }}</p>
    <div class="flex flex-wrap gap-1.5">
      <ParticipantChip
        v-for="participant in participants"
        :key="participant.id"
        :participant="participant"
        type="radio"
        :name="name"
        :checked="picked === participant.id"
        @update:checked="picked = participant.id"
      />
    </div>
  </div>
</template>
