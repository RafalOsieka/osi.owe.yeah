<script setup lang="ts">
// When an Expense happened, as the forms take it: one quiet line with the local date, time
// and zone until tapped, then a `datetime-local` field with the zone picker under it. Sits
// inside a `UForm`, as its `local` field.
const local = defineModel<string>('local', { required: true });
const zone = defineModel<string>('zone', { required: true });

const { locale } = useI18n();

const open = ref(false);
// The device's zone may be an alias missing from the list, so it is always offered.
const zones = computed(() => [...new Set([zone.value, ...Intl.supportedValuesOf('timeZone')])]);
// A local date and time is not an instant, so it is formatted in UTC to keep the device's
// zone from shifting it.
const time = computed(() =>
  local.value
    ? new Intl.DateTimeFormat(locale.value, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${local.value}:00Z`))
    : '',
);
</script>

<template>
  <UFormField v-if="open" name="local" :label="$t('expense.when')">
    <UInput v-model="local" type="datetime-local" class="w-full" />
    <template #help>
      <USelectMenu
        v-model="zone"
        :items="zones"
        :aria-label="$t('expense.timeZone')"
        variant="ghost"
        size="xs"
        icon="i-lucide-globe"
      />
    </template>
  </UFormField>
  <button
    v-else
    type="button"
    class="flex max-w-full cursor-pointer items-center gap-1.5 text-start text-sm text-muted hover:text-default"
    @click="open = true"
  >
    <UIcon name="i-lucide-clock" class="size-4 shrink-0" />
    <span class="sr-only">{{ $t('expense.when') }}:</span>
    <span class="min-w-0 truncate underline decoration-dotted underline-offset-2">
      {{ $t('expense.timeInZone', { time, zone }) }}
    </span>
  </button>
</template>
