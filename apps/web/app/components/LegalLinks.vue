<!-- The privacy notice, linked as a small line where people find it before typing anything in
(New Trip, joining a Trip) and later (My Trips, the Trip tab). The terms will join it. -->
<template>
  <nav :aria-label="$t('legal.title')" class="flex justify-center gap-3 text-sm text-muted">
    <NuxtLink to="/privacy" class="underline-offset-2 hover:text-default hover:underline">
      {{ $t('privacy.link') }}
    </NuxtLink>
  </nav>
</template>
