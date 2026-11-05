<script setup lang="ts">
import { participantNameSchema } from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';

// One name field and a button, used for "Add me" and for adding a Participant. The button is
// the solid primary once a name is typed, and plainly unavailable before. Emits the trimmed
// name and clears itself; the parent does the adding.
defineProps<{ label: string; submitLabel: string }>();
const emit = defineEmits<{ submit: [name: string] }>();

const { t } = useI18n();
const state = reactive({ name: '' });
const typed = computed(() => state.name.trim() !== '');

function validate(form: Partial<typeof state>): FormError[] {
  return participantNameSchema.safeParse(form.name).success
    ? []
    : [{ name: 'name', message: t('participants.nameInvalid') }];
}

function submit(): void {
  emit('submit', participantNameSchema.parse(state.name));
  state.name = '';
}
</script>

<template>
  <UForm :state="state" :validate="validate" class="flex items-start gap-2" @submit="submit">
    <UFormField name="name" :label="label" class="grow">
      <UInput
        v-model="state.name"
        :placeholder="$t('participants.namePlaceholder')"
        class="w-full"
      />
    </UFormField>
    <UButton
      type="submit"
      :color="typed ? 'primary' : 'neutral'"
      :variant="typed ? 'solid' : 'soft'"
      :disabled="!typed"
      icon="i-lucide-user-plus"
      :label="submitLabel"
      class="mt-6 shrink-0 disabled:text-dimmed"
    />
  </UForm>
</template>
