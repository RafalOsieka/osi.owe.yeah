<script setup lang="ts">
import type { ProtoPhoto } from '~/prototype/photos-drafts';

// PROTOTYPE (#282): an Expense's Photos full screen, swiped one to the next (pinch to zoom is
// the browser's own), with who added each and when, its upload state, and, where the Photos
// can be changed (`removable`), Remove behind a confirm sheet saying it can't be brought back.
const { photos, removable = false } = defineProps<{
  photos: ProtoPhoto[];
  removable?: boolean;
}>();
/** The Photo shown, by index; `null` while the viewer is closed. */
const index = defineModel<number | null>({ required: true });
const emit = defineEmits<{ remove: [id: string]; retry: [photo: ProtoPhoto] }>();

const track = useTemplateRef<HTMLElement>('track');
const confirming = ref(false);
const current = computed(() => (index.value === null ? undefined : photos[index.value]));

watch(index, async (now, before) => {
  if (now === null || before !== null) return;
  await nextTick();
  track.value?.scrollTo({ left: now * track.value.clientWidth });
});

function onScroll(): void {
  if (!track.value) return;
  index.value = Math.round(track.value.scrollLeft / track.value.clientWidth);
}

const when = (date: Date) =>
  date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function remove(): void {
  const photo = current.value;
  confirming.value = false;
  if (!photo) return;
  emit('remove', photo.id);
  if (photos.length <= 1) index.value = null;
  else index.value = Math.max(0, (index.value ?? 0) - 1);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="index !== null && current"
      class="fixed inset-0 z-40 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Photos"
    >
      <header class="flex h-14 shrink-0 items-center gap-2 px-2 pt-[env(safe-area-inset-top)]">
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="text-white"
          aria-label="Close"
          @click="index = null"
        />
        <p class="flex-1 text-center text-sm font-medium tabular-nums">
          <template v-if="photos.length > 1">{{ index + 1 }} of {{ photos.length }}</template>
        </p>
        <span class="w-10" />
      </header>
      <div
        ref="track"
        class="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain"
        @scroll.passive="onScroll"
      >
        <div
          v-for="photo in photos"
          :key="photo.id"
          class="grid w-full shrink-0 snap-center place-items-center overflow-auto"
        >
          <img :src="photo.url" alt="" class="max-h-full max-w-full object-contain" />
        </div>
      </div>
      <footer class="shrink-0 space-y-3 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div
          v-if="current.state === 'refused'"
          class="flex gap-2.5 rounded-lg bg-amber-950/80 px-3.5 py-3 text-sm ring-1 ring-amber-400/40"
        >
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div class="flex-1">
            <p class="font-medium">Couldn't upload. It's only on this device.</p>
            <p class="text-white/70">{{ current.reason }}</p>
            <UButton
              class="mt-2"
              size="sm"
              color="neutral"
              variant="solid"
              label="Try again"
              @click="emit('retry', current)"
            />
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1 text-sm">
            <p>Added by {{ current.addedBy }}, {{ when(current.addedAt) }}</p>
            <p v-if="current.state === 'queued'" class="flex items-center gap-1.5 text-white/60">
              <UIcon name="i-lucide-cloud" class="size-4" />
              Not synced yet
            </p>
          </div>
          <UButton
            v-if="removable"
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            class="text-white"
            label="Remove"
            @click="confirming = true"
          />
        </div>
      </footer>
      <UDrawer
        v-model:open="confirming"
        title="Remove this Photo?"
        description="Everyone in the Trip loses it, and it can't be brought back."
        :ui="{ footer: 'pb-2', overlay: 'z-50', content: 'z-50' }"
      >
        <template #footer>
          <UButton
            color="error"
            block
            size="xl"
            icon="i-lucide-trash-2"
            label="Remove Photo"
            @click="remove"
          />
          <UButton
            color="neutral"
            variant="outline"
            block
            size="xl"
            label="Keep it"
            @click="confirming = false"
          />
        </template>
      </UDrawer>
    </div>
  </Teleport>
</template>
