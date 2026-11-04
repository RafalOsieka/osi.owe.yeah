<script setup lang="ts">
// The privacy notice (GDPR Art. 13 and 14) for this instance, run by the `OPERATOR`. Each
// section is its message keys under `privacy.<section>` (`LegalDocument`).
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { t } = useI18n();
useHead({ title: () => t('privacy.title') });

const sections = [
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
    <LegalDocument doc="privacy" :sections="sections" />
  </NuxtLayout>
</template>
