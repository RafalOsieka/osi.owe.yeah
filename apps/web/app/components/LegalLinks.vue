<script setup lang="ts">
// The privacy notice and the terms, linked as a small line where people find them before
// typing anything in (New Trip, joining a Trip) and later (My Trips, the Trip tab).
const pages = ['privacy', 'terms'] as const;
</script>

<template>
  <nav :aria-label="$t('legal.title')" class="flex justify-center gap-3 text-sm text-muted">
    <NuxtLink
      v-for="page in pages"
      :key="page"
      :to="`/${page}`"
      class="underline-offset-2 hover:text-default hover:underline"
    >
      {{ $t(`${page}.title`) }}
    </NuxtLink>
  </nav>
</template>
