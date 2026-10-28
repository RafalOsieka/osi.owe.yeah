<script setup lang="ts">
import { TRIP_TOKEN_HEADER } from '@osi/owe-yeah-domain';

// A Trip link is `/trips/<id>#<token>`: the token in the fragment is the only credential
// (ADR 0001) and is sent to the API in a header.
const route = useRoute();
const { t } = useI18n();

const token = route.hash.slice(1);
const { data: trip, error } = await useFetch(`/api/trips/${String(route.params.id)}`, {
  headers: { [TRIP_TOKEN_HEADER]: token },
  immediate: token !== '',
});

// Only a refused token means the link is bad; any other failure (e.g. no signal) may pass.
const invalidLink = computed(() => token === '' || error.value?.statusCode === 401);

useHead({ title: () => trip.value?.name ?? t('trip.invalidLink') });
</script>

<template>
  <UPage>
    <UPageHeader
      v-if="trip"
      :title="trip.name"
      :description="$t('trip.currency', { currency: trip.currency })"
    />
    <UPageBody v-else-if="invalidLink">
      <UEmpty
        icon="i-lucide-link-2-off"
        :title="$t('trip.invalidLink')"
        :description="$t('trip.invalidLinkHelp')"
      />
    </UPageBody>
    <UPageBody v-else>
      <UEmpty icon="i-lucide-cloud-off" :title="$t('trip.loadFailed')" />
    </UPageBody>
  </UPage>
</template>
