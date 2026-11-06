<script setup lang="ts">
// How to add the app to the Home Screen on iOS, where Safari has no install prompt: with
// Safari's Share icon where the step names it, and each UI term kept on one line. The nudge on
// My Trips and the Install row on the Trip tab both say it.
</script>

<template>
  <i18n-t keypath="install.ios" tag="p" scope="global" class="text-wrap">
    <template #share>
      <span class="whitespace-nowrap font-medium text-highlighted">
        <UIcon
          name="i-lucide-share"
          class="-mt-0.5 me-0.5 inline-block size-4 align-middle"
          aria-hidden="true"
        />
        {{ $t('install.share') }}
      </span>
    </template>
    <template #addToHomeScreen>
      <span class="font-medium whitespace-nowrap text-highlighted">
        {{ $t('install.addToHomeScreen') }}
      </span>
    </template>
  </i18n-t>
</template>
