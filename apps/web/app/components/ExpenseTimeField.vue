<script setup lang="ts">
// When an Expense happened, as the forms take it: one chip with the local date, time and zone
// city until tapped, then a `datetime-local` field (its icon on the left, as the zone's) with
// the zone picker under it, listing each zone by its city and UTC offset, and Done to fold it
// back into the chip. The native picker button stays where the browser puts it, unseen. Times follow the
// device's 12- or 24-hour clock, as the field does. Sits inside a `UForm`, as its `local` field.
const local = defineModel<string>('local', { required: true });
const zone = defineModel<string>('zone', { required: true });

const { locale } = useI18n();

const open = ref(false);
// The device's zone may be an alias missing from the list, so it is always offered. Listed by
// city and offset, and found by either or by its identifier.
const zones = computed(() => {
  const now = new Date();
  return [...new Set([zone.value, ...Intl.supportedValuesOf('timeZone')])].map((value) => ({
    value,
    label: zoneLabel(value, now),
  }));
});
// A local date and time is not an instant, so it is formatted in UTC to keep the device's
// zone from shifting it. Today's date reads "Today".
const time = computed(() => {
  if (!local.value) return '';
  const at = new Date(`${local.value}:00Z`);
  const hourCycle = deviceHourCycle();
  const today = local.value.slice(0, 10) === new Date().toLocaleDateString('sv');
  if (!today) {
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle,
      timeZone: 'UTC',
    }).format(at);
  }
  const day = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }).format(0, 'day');
  const clock = new Intl.DateTimeFormat(locale.value, {
    timeStyle: 'short',
    hourCycle,
    timeZone: 'UTC',
  });
  return `${day.charAt(0).toLocaleUpperCase(locale.value)}${day.slice(1)}, ${clock.format(at)}`;
});
</script>

<template>
  <UFormField v-if="open" name="local" :label="$t('expense.when')" :ui="{ hint: 'flex' }">
    <template #hint>
      <UButton variant="link" :label="$t('form.done')" class="-my-3 -me-4" @click="open = false" />
    </template>
    <UInput
      v-model="local"
      type="datetime-local"
      icon="i-lucide-calendar-clock"
      class="w-full dark:scheme-dark"
      :ui="{ base: '[&::-webkit-calendar-picker-indicator]:opacity-0' }"
    />
    <USelectMenu
      v-model="zone"
      :items="zones"
      value-key="value"
      :filter-fields="['label', 'value']"
      virtualize
      :aria-label="$t('expense.timeZone')"
      icon="i-lucide-globe"
      class="mt-2 w-full"
      :content="{ align: 'start' }"
      :ui="{ content: 'min-w-72' }"
    />
  </UFormField>
  <div v-else>
    <p class="mb-2 text-sm font-medium text-highlighted" aria-hidden="true">
      {{ $t('expense.when') }}
    </p>
    <button
      type="button"
      class="inline-flex h-11 max-w-full cursor-pointer items-center gap-2 rounded-full bg-elevated px-4 text-start text-sm text-default transition-colors hover:bg-accented/70"
      @click="open = true"
    >
      <UIcon name="i-lucide-calendar-clock" class="size-4 shrink-0 text-muted" />
      <span class="sr-only">{{ $t('expense.when') }}:</span>
      <span class="min-w-0 truncate">
        {{ $t('expense.timeInZone', { time, zone: zoneName(zone) }) }}
      </span>
      <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-dimmed" />
    </button>
  </div>
</template>
