<script setup lang="ts">
import { usePrototype } from '~/prototype/photos-drafts';

// PROTOTYPE (#282): the floating variant switcher for one screen, with a panel that fakes the
// network and the reader, and shows the prototype's state. Not part of the design.
const { screen, names } = defineProps<{ screen: string; names: Record<string, string> }>();

const proto = usePrototype();
const keys = computed(() => Object.keys(names));
const current = computed(() => proto.variant(screen));
const panel = ref(false);

function cycle(by: -1 | 1): void {
  const index = keys.value.indexOf(current.value);
  const next = keys.value[(index + by + keys.value.length) % keys.value.length]!;
  proto.setVariant(screen, next);
}

function onKey(event: KeyboardEvent): void {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.closest('input, textarea, [contenteditable]') !== null
  )
    return;
  if (event.key === 'ArrowLeft') cycle(-1);
  if (event.key === 'ArrowRight') cycle(1);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const summary = computed(() => {
  const { drafts, photos } = proto.state;
  const count = (state: string) => drafts.filter((draft) => draft.state === state).length;
  const all = Object.values(photos).flat();
  return [
    `Drafts: ${drafts.length} (upload ${count('upload')}, reading ${count('reading')}, ready ${count('ready')}, failed ${count('failed')}, refused ${count('refused')})`,
    `Photos: ${all.length} (queued ${all.filter((p) => p.state === 'queued').length}, refused ${all.filter((p) => p.state === 'refused').length})`,
    `Trip Photos counted: ${proto.tripPhotos()}`,
  ];
});
</script>

<template>
  <!-- A narrow strip on the left edge, out of the design's way; ⚙ opens the panel. -->
  <div
    class="fixed start-0 top-1/2 z-50 flex -translate-y-1/2 flex-col items-center rounded-e-lg bg-fuchsia-950/85 py-1 text-[0.6875rem] font-semibold text-white shadow-lg ring-1 ring-fuchsia-400"
  >
    <button
      type="button"
      class="cursor-pointer px-1.5 py-1"
      aria-label="Previous variant"
      @click="cycle(-1)"
    >
      ▲
    </button>
    <span class="px-1.5 py-0.5">{{ current }}</span>
    <button
      type="button"
      class="cursor-pointer px-1.5 py-1"
      aria-label="Next variant"
      @click="cycle(1)"
    >
      ▼
    </button>
    <button
      type="button"
      class="cursor-pointer px-1.5 py-1"
      :class="proto.state.online ? '' : 'text-amber-400'"
      aria-label="Prototype controls"
      @click="panel = !panel"
    >
      ⚙
    </button>
  </div>
  <div
    v-if="panel"
    class="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-88 -translate-y-1/2 space-y-2 rounded-xl bg-fuchsia-950/95 p-3 text-xs text-white shadow-xl ring-2 ring-fuchsia-400"
  >
    <div class="flex items-center justify-between">
      <p class="font-semibold">Prototype (not part of the design)</p>
      <button type="button" class="cursor-pointer px-2 py-1" @click="panel = false">✕</button>
    </div>
    <div class="space-y-1">
      <button
        v-for="(name, key) in names"
        :key="key"
        type="button"
        class="block w-full cursor-pointer rounded px-2 py-1.5 text-start"
        :class="key === current ? 'bg-fuchsia-500/50' : 'bg-white/10'"
        @click="proto.setVariant(screen, String(key))"
      >
        {{ key }}: {{ name }}
      </button>
    </div>
    <label class="flex items-center gap-2">
      <input
        type="checkbox"
        :checked="proto.state.online"
        @change="proto.setOnline(($event.target as HTMLInputElement).checked)"
      />
      Online (offline: scans and Photos wait to upload)
    </label>
    <label class="flex items-center gap-2">
      <input v-model="proto.state.failNext" type="checkbox" />
      The next read fails ("couldn't read")
    </label>
    <label class="flex items-center gap-2">
      <input v-model="proto.state.tripFull" type="checkbox" />
      Trip is at its Photo limit (10)
    </label>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="rounded bg-white/15 px-2 py-1" @click="proto.readAllNow()">
        Read all Drafts now
      </button>
      <button type="button" class="rounded bg-white/15 px-2 py-1" @click="proto.refuseSome()">
        Refuse waiting uploads
      </button>
      <button type="button" class="rounded bg-white/15 px-2 py-1" @click="proto.reset()">
        Reset
      </button>
    </div>
    <p v-for="line in summary" :key="line" class="text-fuchsia-200 tabular-nums">{{ line }}</p>
  </div>
</template>
