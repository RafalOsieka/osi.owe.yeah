<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';

// A Participant as a chip with their avatar: a radio for single choice ("Paid by") or a
// checkbox for toggling ("For whom"). A real input covers the chip, so it is announced and
// works from the keyboard like any other. Long names are cut at the chip's maximum width.
const { participant, type, name } = defineProps<{
  participant: Participant;
  type: 'radio' | 'checkbox';
  /** Groups the inputs of one field. */
  name: string;
}>();
const checked = defineModel<boolean>('checked', { required: true });

function change(event: Event): void {
  // SAFETY: the listener sits on the <input> itself.
  checked.value = (event.currentTarget as HTMLInputElement).checked;
}
</script>

<template>
  <label
    class="relative inline-flex max-w-40 items-center gap-1.5 rounded-full border border-default py-0.5 ps-0.5 pe-2.5 text-sm has-checked:border-primary has-checked:bg-primary/10 has-checked:font-semibold has-checked:text-primary has-focus-visible:ring-2 has-focus-visible:ring-primary"
  >
    <input
      :type="type"
      :name="name"
      :checked="checked"
      class="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
      @change="change"
    />
    <ParticipantAvatar :participant="participant" size="2xs" />
    <span class="truncate">{{ participant.name }}</span>
  </label>
</template>
