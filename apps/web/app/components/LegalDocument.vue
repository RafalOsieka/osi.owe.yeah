<script setup lang="ts">
// A legal page's text: `<doc>.updated` and `<doc>.intro`, then each section, titled by
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
  <article class="space-y-6 text-sm leading-relaxed">
    <div class="space-y-2">
      <p class="text-muted">{{ $t(`${doc}.updated`) }}</p>
      <p>{{ $t(`${doc}.intro`) }}</p>
    </div>
    <section
      v-for="{ id, blocks } in sections"
      :key="id"
      :aria-labelledby="`${doc}-${id}`"
      class="space-y-2"
    >
      <h2 :id="`${doc}-${id}`" class="text-base font-semibold text-highlighted">
        {{ $t(`${doc}.${id}.title`) }}
      </h2>
      <template v-for="(block, index) in blocks" :key="index">
        <ul v-if="'ul' in block" class="list-disc space-y-1 ps-5">
          <LegalText v-for="key in block.ul" :key="key" :keypath="`${doc}.${id}.${key}`" tag="li" />
        </ul>
        <LegalText v-else :keypath="`${doc}.${id}.${block.p}`" tag="p" />
      </template>
    </section>
  </article>
</template>
