<script setup lang="ts">
// The terms (the regulamin of UŚUDE art. 8, and the terms and points of contact of DSA
// art. 11 to 16) for this instance, provided by the `OPERATOR`. Each section is its message
// keys under `terms.<section>` (`LegalDocument`).
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { t } = useI18n();
useHead({ title: () => t('terms.title') });

const sections = [
  { id: 'provider', blocks: [{ p: 'who' }, { p: 'register' }, { p: 'contact' }] },
  {
    id: 'service',
    blocks: [
      { p: 'intro' },
      { ul: ['trips', 'share', 'balances', 'notifications', 'offline'] },
      { p: 'free' },
    ],
  },
  {
    id: 'requirements',
    blocks: [{ p: 'intro' }, { ul: ['browser', 'connection', 'notifications'] }, { p: 'cookies' }],
  },
  { id: 'agreement', blocks: [{ p: 'start' }, { p: 'endYou' }, { p: 'endUs' }] },
  {
    id: 'content',
    blocks: [
      { p: 'intro' },
      { ul: ['unlawful', 'offensive', 'sensitive', 'misuse'] },
      { p: 'others' },
    ],
  },
  { id: 'moderation', blocks: [{ p: 'notMonitored' }, { p: 'actions' }, { p: 'reasons' }] },
  {
    id: 'report',
    blocks: [{ p: 'how' }, { ul: ['reasons', 'location', 'contact', 'goodFaith'] }, { p: 'after' }],
  },
  { id: 'contact', blocks: [{ p: 'authorities' }, { p: 'users' }, { p: 'languages' }] },
  { id: 'complaints', blocks: [{ p: 'how' }, { p: 'answer' }] },
  { id: 'test', blocks: [{ p: 'body' }, { p: 'liability' }] },
  { id: 'data', blocks: [{ p: 'body' }] },
  { id: 'licenses', blocks: [{ p: 'body' }] },
  { id: 'changes', blocks: [{ p: 'body' }] },
  { id: 'law', blocks: [{ p: 'body' }] },
];
</script>

<template>
  <NuxtLayout name="form" :title="$t('terms.title')" parent="/" title-hidden>
    <LegalDocument doc="terms" :sections="sections" />
  </NuxtLayout>
</template>
