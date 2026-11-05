<script setup lang="ts">
// A legal page's text, set for reading: its title large (the layout keeps its own for screen
// readers), `<doc>.updated` and `<doc>.intro`, then each section in one card, titled by
// `<doc>.<section>.title`, with its blocks in order: paragraphs, and lists of items, each by
// its key under `<doc>.<section>`. Used by `/privacy` and `/terms`, app routes like any other,
// so the service worker's precache opens them offline.
type Block = { p: string } | { ul: readonly string[] };

defineProps<{
  doc: 'privacy' | 'terms';
  sections: readonly { id: string; blocks: readonly Block[] }[];
}>();
</script>

<template>
  <article class="pb-2 text-[0.9375rem] leading-relaxed">
    <header class="px-1 pt-2 pb-6">
      <p aria-hidden="true" class="text-3xl font-semibold tracking-tight text-highlighted">
        {{ $t(`${doc}.title`) }}
      </p>
      <p class="mt-1.5 text-sm text-muted">{{ $t(`${doc}.updated`) }}</p>
      <p class="mt-4 text-pretty">{{ $t(`${doc}.intro`) }}</p>
    </header>
    <div class="card divide-y divide-default">
      <section
        v-for="{ id, blocks } in sections"
        :key="id"
        :aria-labelledby="`${doc}-${id}`"
        class="space-y-2.5 px-4 py-5 text-toned"
      >
        <h2 :id="`${doc}-${id}`" class="text-base font-semibold text-highlighted">
          {{ $t(`${doc}.${id}.title`) }}
        </h2>
        <template v-for="(block, index) in blocks" :key="index">
          <ul v-if="'ul' in block" class="list-disc space-y-1.5 ps-5 marker:text-dimmed">
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
  </article>
</template>
