<script setup lang="ts">
import { LIMITS, usePrototype, type ProtoPhoto } from '~/prototype/photos-drafts';

// PROTOTYPE (#282): the Expense form's Photos, in three variants, each mounted where it sits
// (`place`):
// A: a "Photos" card at the end of the form, square tiles and a dashed Add tile (one picker:
//    the phone's own chooser offers the camera or the gallery).
// B: a camera button in the header (with the count) opening Take a photo / Choose from
//    gallery, and a strip of thumbnails right under the amount once there are any.
// C: one row in the options card ("Add Photo", or the thumbnails and a count), opening a
//    Photos sheet with large previews.
const { variant, place } = defineProps<{
  variant: string;
  place: 'header' | 'top' | 'options' | 'end';
}>();
const photos = defineModel<ProtoPhoto[]>({ required: true });

const proto = usePrototype();
const toast = useToast();
const viewing = ref<number | null>(null);
const chooser = ref(false);
const sheet = ref(false);
const anyInput = useTemplateRef<HTMLInputElement>('any');
const cameraInput = useTemplateRef<HTMLInputElement>('camera');
const galleryInput = useTemplateRef<HTMLInputElement>('gallery');

const full = computed(() => photos.value.length >= LIMITS.perExpense);
const tripFull = computed(() => proto.tripPhotos() >= LIMITS.perTrip);
const hint = computed(() => {
  if (full.value) return `An Expense can have at most ${LIMITS.perExpense} Photos.`;
  if (tripFull.value)
    return `This Trip already has ${LIMITS.perTrip} Photos, the most it can have. Remove one to add another.`;
  return null;
});

async function picked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  chooser.value = false;
  if (!file) return;
  const url = URL.createObjectURL(file);
  const decodes = await new Promise<boolean>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
  if (!decodes) {
    toast.add({ title: "This file isn't a picture Owe Yeah can open.", color: 'warning' });
    return;
  }
  photos.value = [...photos.value, proto.newPhoto(url)];
}

function remove(id: string): void {
  photos.value = photos.value.filter((photo) => photo.id !== id);
}
</script>

<template>
  <input ref="any" type="file" accept="image/*" class="hidden" @change="picked" />
  <input
    ref="camera"
    type="file"
    accept="image/*"
    capture="environment"
    class="hidden"
    @change="picked"
  />
  <input ref="gallery" type="file" accept="image/*" class="hidden" @change="picked" />

  <!-- A: a card at the end. -->
  <section v-if="variant === 'A' && place === 'end'">
    <p class="mb-2 px-1 text-sm font-medium text-muted">Photos</p>
    <div class="card p-3">
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="(photo, i) in photos"
          :key="photo.id"
          type="button"
          class="aspect-square cursor-pointer"
          :aria-label="`Photo ${i + 1}`"
          @click="viewing = i"
        >
          <PrototypePhotoThumb :photo="photo" class="size-full" />
        </button>
        <button
          v-if="!hint"
          type="button"
          class="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-accented text-sm font-medium text-primary hover:bg-elevated/60"
          @click="anyInput?.click()"
        >
          <UIcon name="i-lucide-camera" class="size-6" />
          Add Photo
        </button>
      </div>
      <p v-if="photos.length === 0 && !hint" class="mt-2 px-1 text-sm text-muted">
        The paper Receipt, a screenshot, or what you bought.
      </p>
      <p v-if="hint" class="mt-2 px-1 text-sm text-muted">{{ hint }}</p>
    </div>
  </section>

  <!-- B: a camera button in the header... -->
  <UButton
    v-else-if="variant === 'B' && place === 'header'"
    color="neutral"
    variant="ghost"
    :aria-label="`Photos: ${photos.length}`"
    @click="hint ? toast.add({ title: hint }) : (chooser = true)"
  >
    <span class="relative">
      <UIcon name="i-lucide-camera" class="block size-5" :class="hint ? 'text-dimmed' : ''" />
      <span
        v-if="photos.length > 0"
        class="absolute -end-2 -top-1.5 grid size-4 place-items-center rounded-full bg-primary text-[0.625rem] font-bold text-inverted"
      >
        {{ photos.length }}
      </span>
    </span>
  </UButton>
  <!-- ...and a strip under the amount. -->
  <div v-else-if="variant === 'B' && place === 'top' && photos.length > 0" class="-mt-2 flex gap-2">
    <button
      v-for="(photo, i) in photos"
      :key="photo.id"
      type="button"
      class="h-20 w-16 cursor-pointer"
      :aria-label="`Photo ${i + 1}`"
      @click="viewing = i"
    >
      <PrototypePhotoThumb :photo="photo" class="size-full" />
    </button>
  </div>

  <!-- C: a row in the options card. -->
  <button
    v-else-if="variant === 'C' && place === 'options'"
    type="button"
    class="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-start font-medium transition-colors hover:bg-elevated/60"
    :class="photos.length > 0 ? 'text-highlighted' : 'text-primary'"
    @click="
      photos.length > 0 ? (sheet = true) : hint ? toast.add({ title: hint }) : anyInput?.click()
    "
  >
    <UIcon v-if="photos.length === 0" name="i-lucide-image-plus" class="size-5 shrink-0" />
    <span v-else class="flex shrink-0 -space-x-3">
      <PrototypePhotoThumb
        v-for="photo in photos"
        :key="photo.id"
        :photo="photo"
        class="h-10 w-8 ring-2 ring-(--ui-bg)"
      />
    </span>
    <span class="flex-1">{{ photos.length > 0 ? 'Photos' : 'Add Photo' }}</span>
    <span v-if="photos.length > 0" class="font-normal text-muted tabular-nums">
      {{ photos.length }}
    </span>
    <UIcon v-if="photos.length > 0" name="i-lucide-chevron-right" class="size-5 text-dimmed" />
  </button>

  <!-- B's chooser: camera or gallery. -->
  <UDrawer v-model:open="chooser" title="Add a Photo" :ui="{ footer: 'pb-2' }">
    <template #footer>
      <UButton
        block
        size="xl"
        icon="i-lucide-camera"
        label="Take a photo"
        @click="cameraInput?.click()"
      />
      <UButton
        block
        size="xl"
        color="neutral"
        variant="outline"
        icon="i-lucide-images"
        label="Choose from gallery"
        @click="galleryInput?.click()"
      />
      <UButton
        block
        size="xl"
        color="neutral"
        variant="ghost"
        label="Cancel"
        @click="chooser = false"
      />
    </template>
  </UDrawer>

  <!-- C's sheet: the Photos large, each removable, and Add. -->
  <UDrawer v-model:open="sheet" title="Photos" :ui="{ footer: 'pb-2' }">
    <template #body>
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="(photo, i) in photos"
          :key="photo.id"
          type="button"
          class="aspect-3/4 cursor-pointer"
          @click="viewing = i"
        >
          <PrototypePhotoThumb :photo="photo" class="size-full" />
        </button>
      </div>
      <p v-if="hint" class="mt-3 text-sm text-muted">{{ hint }}</p>
    </template>
    <template #footer>
      <UButton
        v-if="!hint"
        block
        size="xl"
        icon="i-lucide-image-plus"
        label="Add Photo"
        @click="anyInput?.click()"
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

  <PrototypePhotoViewer
    v-model="viewing"
    :photos="photos"
    removable
    @remove="remove"
    @retry="proto.retry"
  />
</template>
