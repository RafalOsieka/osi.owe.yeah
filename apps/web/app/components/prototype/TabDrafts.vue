<script setup lang="ts">
import { LIMITS, usePrototype } from '~/prototype/photos-drafts';

// PROTOTYPE (#282): the Expenses tab's Drafts and its way into Scan a Receipt, in three
// variants, each mounted where it sits (`place`: above the list, or the floating action):
// A: a "Drafts" section (label over a card of rows); Scan beside "+ Expense" as its own button.
// B: a strip of tall Photo cards with the state on each; "+" opens Type or Scan.
// C: one summary row ("2 Drafts to check") opening a sheet of Drafts; "+ Expense" stays as is
//    and Scan a Receipt sits on top of the new-Expense form (and in the sheet).
const { place } = defineProps<{ place: 'list' | 'action' | 'none' }>();

const proto = usePrototype();
const { trip } = useOpenTrip();
const toast = useToast();
const status = useDraftStatus();
const variant = computed(() => proto.variant('expenses'));
const drafts = computed(() => proto.state.drafts);
const scanInput = useTemplateRef<HTMLInputElement>('scan');
const chooser = ref(false);
const sheet = ref(false);
const newExpense = computed(() => `/trips/${trip.value.id}/expenses/new`);

const attention = computed(() =>
  drafts.value.filter(({ state }) => ['ready', 'failed', 'refused'].includes(state)),
);
const summary = computed(() => {
  const ready = drafts.value.filter(({ state }) => state === 'ready').length;
  const rest = [
    ['reading', 'being read'],
    ['upload', 'waiting to upload'],
    ['failed', "couldn't be read"],
    ['refused', "couldn't upload"],
  ]
    .map(([state, label]) => [drafts.value.filter((d) => d.state === state).length, label] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  return {
    title:
      ready > 0
        ? `${ready} ${ready === 1 ? 'Draft' : 'Drafts'} to check`
        : `${drafts.value.length} ${drafts.value.length === 1 ? 'Draft' : 'Drafts'}`,
    rest: rest.join(' · '),
  };
});

/** Why Scan a Receipt can't be used now, at a limit; `null` while it can. */
const limit = computed(() => {
  if (drafts.value.length >= LIMITS.drafts)
    return `${LIMITS.drafts} Drafts are waiting. Save or discard one to scan another.`;
  if (proto.tripPhotos() >= LIMITS.perTrip)
    return `This Trip already has ${LIMITS.perTrip} Photos, the most it can have. Remove one to add another.`;
  return null;
});

function startScan(): void {
  chooser.value = false;
  if (limit.value) {
    toast.add({ title: limit.value, color: 'warning', icon: 'i-lucide-circle-alert' });
    return;
  }
  scanInput.value?.click();
}

function scanned(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  proto.scan(URL.createObjectURL(file));
  sheet.value = false;
  toast.add({
    title: proto.state.online ? 'Draft is being read' : 'Draft saved on this device',
    description: proto.state.online
      ? "Keep going. It shows here when it's ready to check."
      : "It's read once you're back online.",
    icon: 'i-lucide-scan-line',
  });
}

defineExpose({ startScan });
</script>

<template>
  <input
    ref="scan"
    type="file"
    accept="image/*"
    capture="environment"
    class="hidden"
    @change="scanned"
  />

  <template v-if="place === 'list' && drafts.length > 0">
    <!-- A: a section of rows. -->
    <section v-if="variant === 'A'" class="mb-6">
      <p class="mb-2 px-1 text-sm font-medium text-muted">Drafts · not counted yet</p>
      <div class="card divide-y divide-default overflow-hidden">
        <PrototypeDraftRow v-for="draft in drafts" :key="draft.id" :draft="draft" />
      </div>
    </section>

    <!-- B: a strip of Photo cards. -->
    <section v-else-if="variant === 'B'" class="mb-6">
      <p class="mb-2 px-1 text-sm font-medium text-muted">Drafts · not counted yet</p>
      <div class="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        <NuxtLink
          v-for="draft in drafts"
          :key="draft.id"
          :to="`/trips/${trip.id}/drafts/${draft.id}`"
          class="relative h-48 w-36 shrink-0 snap-start overflow-hidden rounded-xl bg-elevated ring-1 ring-default"
          :class="{ 'ring-2 ring-primary': draft.state === 'ready' }"
        >
          <img :src="draft.photo.url" alt="" class="size-full object-cover object-top" />
          <span
            class="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1 rounded-lg bg-default/92 px-2 py-1.5 text-xs font-semibold shadow-sm backdrop-blur"
            :class="status(draft).tone"
          >
            <UIcon
              :name="status(draft).icon"
              class="size-3.5 shrink-0"
              :class="status(draft).iconClass"
            />
            <span class="truncate">{{ status(draft).label }}</span>
          </span>
        </NuxtLink>
        <button
          type="button"
          class="flex h-48 w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accented text-sm font-medium text-primary"
          @click="startScan"
        >
          <UIcon name="i-lucide-scan-line" class="size-6" />
          Scan
        </button>
      </div>
    </section>

    <!-- C: one summary row, opening a sheet. -->
    <button
      v-else-if="variant === 'C'"
      type="button"
      class="card mb-6 flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start"
      @click="sheet = true"
    >
      <span class="flex shrink-0 -space-x-4">
        <PrototypePhotoThumb
          v-for="draft in drafts.slice(0, 3)"
          :key="draft.id"
          :photo="draft.photo"
          class="h-12 w-9 ring-2 ring-(--ui-bg)"
        />
      </span>
      <span class="min-w-0 flex-1 leading-snug">
        <span
          class="block font-semibold"
          :class="attention.length > 0 ? 'text-primary' : 'text-highlighted'"
        >
          {{ summary.title }}
        </span>
        <span class="block text-sm text-muted">{{ summary.rest || 'Not counted yet' }}</span>
      </span>
      <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
    </button>
  </template>

  <template v-if="place === 'action'">
    <div v-if="variant === 'A'" class="flex items-center gap-3">
      <UButton
        icon="i-lucide-scan-line"
        label="Scan"
        color="neutral"
        variant="solid"
        size="xl"
        aria-label="Scan a Receipt"
        class="rounded-full bg-default px-4 text-primary shadow-lg ring-1 shadow-black/15 ring-default hover:bg-elevated dark:shadow-black/40"
        :class="{ 'opacity-50': limit }"
        @click="startScan"
      />
      <UButton
        icon="i-lucide-plus"
        label="Expense"
        :to="newExpense"
        size="xl"
        class="rounded-full px-5 shadow-lg shadow-black/15 dark:shadow-black/40"
      />
    </div>
    <UButton
      v-else-if="variant === 'B'"
      icon="i-lucide-plus"
      size="xl"
      aria-label="Add"
      class="rounded-full p-4 shadow-lg shadow-black/15 dark:shadow-black/40"
      @click="chooser = true"
    />
    <UButton
      v-else
      icon="i-lucide-plus"
      label="Expense"
      :to="newExpense"
      size="xl"
      class="rounded-full px-5 shadow-lg shadow-black/15 dark:shadow-black/40"
    />
  </template>

  <!-- B's chooser. -->
  <UDrawer v-if="place === 'action'" v-model:open="chooser" title="Add" :ui="{ footer: 'pb-2' }">
    <template #body>
      <div class="space-y-2">
        <NuxtLink
          :to="newExpense"
          class="flex min-h-16 items-center gap-3 rounded-xl px-3 ring-1 ring-default hover:bg-elevated/60"
        >
          <UIcon name="i-lucide-pencil-line" class="size-6 text-primary" />
          <span class="leading-snug">
            <span class="block font-medium text-highlighted">Type an Expense</span>
            <span class="block text-sm text-muted">Amount, who paid, for whom</span>
          </span>
        </NuxtLink>
        <button
          type="button"
          class="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-start ring-1 ring-default hover:bg-elevated/60"
          @click="startScan"
        >
          <UIcon name="i-lucide-scan-line" class="size-6 text-primary" />
          <span class="leading-snug">
            <span class="block font-medium text-highlighted">Scan a Receipt</span>
            <span class="block text-sm text-muted">
              {{ limit ?? 'Take a photo; its Line items are read for you to check' }}
            </span>
          </span>
        </button>
      </div>
    </template>
    <template #footer>
      <UButton
        block
        size="xl"
        color="neutral"
        variant="outline"
        label="Cancel"
        @click="chooser = false"
      />
    </template>
  </UDrawer>

  <!-- C's sheet. -->
  <UDrawer
    v-if="place === 'list'"
    v-model:open="sheet"
    title="Drafts"
    description="Not counted in any Balance until saved."
    :ui="{ footer: 'pb-2', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div class="divide-y divide-default">
        <PrototypeDraftRow v-for="draft in drafts" :key="draft.id" :draft="draft" />
      </div>
    </template>
    <template #footer>
      <UButton
        block
        size="xl"
        icon="i-lucide-scan-line"
        label="Scan a Receipt"
        @click="startScan"
      />
      <UButton
        block
        size="xl"
        color="neutral"
        variant="outline"
        label="Done"
        @click="sheet = false"
      />
    </template>
  </UDrawer>
</template>
