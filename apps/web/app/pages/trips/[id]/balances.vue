<script setup lang="ts">
// The Balances tab: what each Participant paid, their share and their balance.
definePageMeta({ scrollToTop: false });
useKeptScroll();

const { trip, claim } = useOpenTrip();
</script>

<template>
  <NuxtLayout name="trip">
    <BalancesTable :trip="trip" :claim-id="claim?.id" />
  </NuxtLayout>
</template>
