<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';

// A Participant as a chip with their avatar, ticked when chosen: a radio for single choice
// ("Paid by") or a checkbox for toggling ("For whom"). It fills its cell of the pickers' grid. A real input covers the chip, so it is announced and
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
    class="group relative flex h-11 min-w-0 items-center gap-2 rounded-full bg-default ps-1.5 pe-3.5 text-sm font-medium text-default ring ring-accented transition-colors has-checked:bg-primary/10 has-checked:text-highlighted has-checked:ring-primary/50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
  >
    <input
      :type="type"
      :name="name"
      :checked="checked"
      class="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
      @change="change"
    />
    <ParticipantAvatar :participant="participant" size="xs" />
    <span class="min-w-0 flex-1 truncate">{{ participant.name }}</span>
    <UIcon
      name="i-lucide-check"
      class="-me-1 hidden size-4 shrink-0 text-primary group-has-checked:block"
      aria-hidden="true"
    />
  </label>
</template>
