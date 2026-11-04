<script setup lang="ts">
// One paragraph or list item of a legal page, by message key. The message may place the
// operator's details (`{name}`, `{business}`, `{nip}`, `{email}`) and the links of the
// authorities and documents it cites (`{dpa}`, `{uodo}`) by name.
defineProps<{ keypath: string; tag: 'p' | 'li' }>();

const link = 'text-primary underline underline-offset-2';
// The complaint authority's site, by its address in every language.
const uodo = new URL('https://uodo.gov.pl');
</script>

<template>
  <i18n-t :keypath="keypath" :tag="tag" scope="global">
    <template #name>{{ OPERATOR.name }}</template>
    <template #business>{{ OPERATOR.business }}</template>
    <template #nip>{{ OPERATOR.nip }}</template>
    <template #email>
      <a :href="`mailto:${OPERATOR.email}`" :class="link">{{ OPERATOR.email }}</a>
    </template>
    <template #dpa>
      <a
        href="https://www.cloudflare.com/cloudflare-customer-dpa/"
        target="_blank"
        rel="noopener"
        :class="link"
      >
        {{ $t('privacy.recipients.dpa') }}
      </a>
    </template>
    <template #uodo>
      <a :href="uodo.href" target="_blank" rel="noopener" :class="link">{{ uodo.host }}</a>
    </template>
  </i18n-t>
</template>
