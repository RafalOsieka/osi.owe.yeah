<script setup lang="ts">
// A legal page's text, set for reading: its title large (the layout keeps its own for screen
// readers), `<doc>.updated` and `<doc>.intro`, an "On this page" card linking every section,
// then each section in its own card, titled by `<doc>.<section>.title`, with its blocks in
// order: paragraphs, and lists of items, each by its key under `<doc>.<section>`. A link back
// to the contents closes the page. The links scroll in place rather than navigate, so back still
// leaves the page. Used by `/privacy` and `/terms`, app routes like any other,
// so the service worker's precache opens them offline.
type Block = { p: string } | { ul: readonly string[] };

const { doc } = defineProps<{
  doc: 'privacy' | 'terms';
  sections: readonly { id: string; blocks: readonly Block[] }[];
}>();

const anchor = (id: string) => `${doc}-${id}`;

// Scrolls to the part `id` names and moves focus there, for screen readers and keyboards.
function jump(id: string): void {
  const target = document.getElementById(anchor(id));
  if (!target) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}
</script>

<template>
  <article class="pb-2 text-[0.9375rem] leading-relaxed">
    <header class="px-1 pt-2 pb-6">
      <p aria-hidden="true" class="text-3xl font-semibold tracking-tight text-highlighted">
        {{ $t(`${doc}.title`) }}
      </p>
      <p class="mt-1.5 text-sm text-muted">{{ $t(`${doc}.updated`) }}</p>
      <p class="mt-4 text-pretty text-default">{{ $t(`${doc}.intro`) }}</p>
    </header>

    <nav
      :id="anchor('contents')"
      :aria-labelledby="anchor('contents-heading')"
      tabindex="-1"
      class="mb-6 scroll-mt-20 outline-none"
    >
      <h2 :id="anchor('contents-heading')" class="section-heading">
        {{ $t('legal.contents') }}
      </h2>
      <ol class="card divide-y divide-default overflow-hidden">
        <li v-for="({ id }, index) in sections" :key="id">
          <a
            :href="`#${anchor(id)}`"
            class="flex min-h-11 items-center gap-3 px-4 py-2.5 text-default transition-colors hover:bg-elevated/60 active:bg-elevated"
            @click.prevent="jump(id)"
          >
            <span class="w-5 shrink-0 text-sm text-muted tabular-nums" aria-hidden="true">
              {{ index + 1 }}
            </span>
            <span class="min-w-0 flex-1">{{ $t(`${doc}.${id}.title`) }}</span>
            <UIcon name="i-lucide-arrow-down" class="size-4 shrink-0 text-dimmed" />
          </a>
        </li>
      </ol>
    </nav>

    <div class="space-y-4">
      <section
        v-for="({ id, blocks }, index) in sections"
        :id="anchor(id)"
        :key="id"
        :aria-labelledby="`${anchor(id)}-heading`"
        tabindex="-1"
        class="card scroll-mt-20 space-y-3 px-4 pt-4 pb-5 text-default outline-none"
      >
        <h2
          :id="`${anchor(id)}-heading`"
          class="flex items-baseline gap-3 pb-1 text-lg font-semibold tracking-tight text-highlighted"
        >
          <span class="w-5 shrink-0 text-sm font-medium text-muted tabular-nums" aria-hidden="true">
            {{ index + 1 }}
          </span>
          <span class="min-w-0 flex-1">{{ $t(`${doc}.${id}.title`) }}</span>
        </h2>
        <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
          <ul v-if="'ul' in block" class="list-disc space-y-2 ps-5 marker:text-dimmed">
            <LegalText
              v-for="key in block.ul"
              :key="key"
              :keypath="`${doc}.${id}.${key}`"
              tag="li"
            />
          </ul>
          <LegalText v-else :keypath="`${doc}.${id}.${block.p}`" tag="p" />
        </template>
      </section>
    </div>

    <p class="mt-6 flex justify-center">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-up"
        :label="$t('legal.backToContents')"
        @click="jump('contents')"
      />
    </p>
  </article>
</template>
