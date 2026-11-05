<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';

// App pages (My Trips): the app mark with the page's `title` as its large heading (or the app's
// name, e.g. on a first visit), and a "⋯" menu holding the color mode. An optional `#action`
// floats at the bottom right; the page's last element can sit at the bottom (`mt-auto`), just
// above the action or the safe area.
const { title = null } = defineProps<{
  /** The page's heading, shown large in the header instead of the app's name. */
  title?: string | null;
}>();

const { t } = useI18n();
const colorMode = useColorMode();

const modes = [
  { mode: 'system', icon: 'i-lucide-monitor' },
  { mode: 'light', icon: 'i-lucide-sun' },
  { mode: 'dark', icon: 'i-lucide-moon' },
] as const;

const menu = computed<DropdownMenuItem[]>(() => [
  { type: 'label', label: t('colorMode.title') },
  ...modes.map(({ mode, icon }) => ({
    type: 'checkbox' as const,
    label: t(`colorMode.${mode}`),
    icon,
    checked: colorMode.preference === mode,
    onUpdateChecked: () => (colorMode.preference = mode),
  })),
]);
</script>

<template>
  <header
    class="sticky top-0 z-10 bg-canvas pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150"
  >
    <div class="flex h-16 items-center gap-2.5 ps-4 pe-2">
      <template v-if="title">
        <AppBrandMark class="size-7 text-primary" />
        <h1 class="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight text-highlighted">
          {{ title }}
        </h1>
      </template>
      <NuxtLink
        v-else
        to="/"
        class="flex min-w-0 flex-1 items-center gap-2.5 text-lg font-semibold tracking-tight text-highlighted"
      >
        <AppBrandMark class="size-6 text-primary" />
        <span class="truncate">{{ $t('app.title') }}</span>
      </NuxtLink>
      <!-- Kept off the screen's edge by the same gutter as the content: 48 px rows in the text
           colour under a smaller, muted section label. -->
      <UDropdownMenu
        :items="menu"
        :content="{ align: 'end', collisionPadding: 16 }"
        :ui="{
          item: 'min-h-12',
          itemLabel: 'text-highlighted',
          itemLeadingIcon: 'text-muted',
          label: 'px-3 pt-3 pb-2 text-sm font-semibold text-muted',
        }"
      >
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="ghost"
          :aria-label="$t('app.more')"
        />
      </UDropdownMenu>
    </div>
  </header>
  <main
    class="flex min-h-[calc(100dvh-4rem-env(safe-area-inset-top))] flex-col px-4 pt-2"
    :class="
      $slots.action
        ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
        : 'pb-[calc(1rem+env(safe-area-inset-bottom))]'
    "
  >
    <slot />
  </main>
  <div
    v-if="$slots.action"
    class="pointer-events-none fixed inset-x-0 bottom-0 mx-auto flex max-w-120 justify-end p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
  >
    <div class="pointer-events-auto">
      <slot name="action" />
    </div>
  </div>
</template>
