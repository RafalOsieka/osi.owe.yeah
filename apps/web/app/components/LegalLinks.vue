<script setup lang="ts">
// The privacy notice and the terms, linked as a quiet line where people find them before
// typing anything in (New Trip, joining a Trip) and later (My Trips, the Trip tab). Each link
// is touch-sized, though the line looks small.
const pages = ['privacy', 'terms'] as const;
</script>

<template>
  <nav :aria-label="$t('legal.title')" class="flex justify-center gap-2 text-sm text-muted">
    <NuxtLink
      v-for="page in pages"
      :key="page"
      :to="`/${page}`"
      class="flex min-h-11 items-center px-2 underline-offset-2 hover:text-default hover:underline"
    >
      {{ $t(`${page}.title`) }}
    </NuxtLink>
  </nav>
</template>
