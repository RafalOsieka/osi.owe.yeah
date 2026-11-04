<script setup lang="ts">
// The privacy notice (GDPR Art. 13 and 14) for this instance, run by the `OPERATOR`. An app
// route like any other, so the service worker's precache opens it offline. Each section is
// its message keys under `privacy.<section>`, in order: paragraphs, and lists of items.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { t } = useI18n();
useHead({ title: () => t('privacy.title') });

type Block = { p: string } | { ul: readonly string[] };

const sections: readonly { id: string; blocks: readonly Block[] }[] = [
  { id: 'controller', blocks: [{ p: 'who' }, { p: 'contact' }] },
  {
    id: 'data',
    blocks: [
      { p: 'intro' },
      { ul: ['trips', 'device', 'notifications', 'reminders', 'ip'] },
      { p: 'none' },
    ],
  },
  { id: 'namedByOthers', blocks: [{ p: 'body' }] },
  { id: 'purposes', blocks: [{ p: 'sync' }, { p: 'security' }, { p: 'voluntary' }] },
  {
    id: 'recipients',
    blocks: [{ p: 'tripLink' }, { p: 'cloudflare' }, { p: 'push' }, { p: 'server' }],
  },
  {
    id: 'retention',
    blocks: [{ p: 'test' }, { p: 'notifications' }, { p: 'ip' }, { p: 'device' }],
  },
  {
    id: 'rights',
    blocks: [{ p: 'list' }, { p: 'how' }, { p: 'noLink' }, { p: 'inApp' }, { p: 'complaint' }],
  },
  {
    id: 'storage',
    blocks: [
      { p: 'intro' },
      { ul: ['indexedDb', 'localStorage', 'serviceWorker'] },
      { p: 'remove' },
    ],
  },
  { id: 'changes', blocks: [{ p: 'body' }] },
];
</script>

<template>
  <NuxtLayout name="form" :title="$t('privacy.title')" parent="/">
    <article class="space-y-6 text-sm leading-relaxed">
      <div class="space-y-2">
        <p class="text-muted">{{ $t('privacy.updated') }}</p>
        <p>{{ $t('privacy.intro') }}</p>
      </div>
      <section
        v-for="{ id, blocks } in sections"
        :key="id"
        :aria-labelledby="`privacy-${id}`"
        class="space-y-2"
      >
        <h2 :id="`privacy-${id}`" class="text-base font-semibold">
          {{ $t(`privacy.${id}.title`) }}
        </h2>
        <template v-for="(block, index) in blocks" :key="index">
          <ul v-if="'ul' in block" class="list-disc space-y-1 ps-5">
            <LegalText
              v-for="key in block.ul"
              :key="key"
              :keypath="`privacy.${id}.${key}`"
              tag="li"
            />
          </ul>
          <LegalText v-else :keypath="`privacy.${id}.${block.p}`" tag="p" />
        </template>
      </section>
    </article>
  </NuxtLayout>
</template>
