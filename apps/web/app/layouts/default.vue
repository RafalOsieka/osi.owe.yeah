<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';

// App pages (My Trips): the app's name, and a "⋯" menu holding the color mode. An optional
// `#action` floats at the bottom right.
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
  <header class="sticky top-0 z-10 bg-default pt-[env(safe-area-inset-top)]">
    <div class="flex h-14 items-center gap-2 ps-4 pe-2">
      <NuxtLink to="/" class="min-w-0 flex-1 truncate text-xl font-bold">
        {{ $t('app.title') }}
      </NuxtLink>
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="ghost"
          :aria-label="$t('app.more')"
        />
      </UDropdownMenu>
    </div>
  </header>
  <main class="px-4 pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))]">
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
