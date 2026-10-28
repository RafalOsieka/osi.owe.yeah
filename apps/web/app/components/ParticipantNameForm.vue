<script setup lang="ts">
import { participantNameSchema } from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';

// One name field and a button, used for "Add me" and for adding a Participant. Emits the
// trimmed name and clears itself; the parent does the adding.
defineProps<{ label: string; submitLabel: string }>();
const emit = defineEmits<{ submit: [name: string] }>();

const { t } = useI18n();
const state = reactive({ name: '' });

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
    <UButton type="submit" icon="i-lucide-user-plus" :label="submitLabel" class="mt-6" />
  </UForm>
</template>
