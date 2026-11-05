<script setup lang="ts">
import { encode } from 'uqr';

// A QR code of `text`, made on this device, so it shows without signal. Black on white (a softer
// off-white in dark mode, so it is not the brightest thing at night), with the quiet zone
// scanners need, as one SVG path that scales sharply.
const { text, label } = defineProps<{ text: string; label: string }>();

const qr = computed(() => {
  const { size, data } = encode(text, { border: 4 });
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('');
  return { size, path };
});
</script>

<template>
  <svg
    role="img"
    :aria-label="label"
    :viewBox="`0 0 ${qr.size} ${qr.size}`"
    shape-rendering="crispEdges"
    class="rounded-2xl bg-white dark:bg-stone-200"
  >
    <path :d="qr.path" fill="#000" />
  </svg>
</template>
