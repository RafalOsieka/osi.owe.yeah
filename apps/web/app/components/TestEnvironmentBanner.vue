<script setup lang="ts">
import { environmentResponseSchema } from '@osi/owe-yeah-domain';

// On every screen of a test environment, whose data may be wiped (#105). The server says
// whether it is one (`/api/environment`), asked on every open; the device remembers the last
// answer, so the banner shows offline too. Closing it hides it until the app is opened again.
const REMEMBERED_KEY = 'owe-yeah:test-environment';

const testEnvironment = ref(localStorage.getItem(REMEMBERED_KEY) === 'true');
const closed = ref(false);

async function ask(): Promise<void> {
  const answer = environmentResponseSchema.parse(await syncApi('/api/environment'));
  testEnvironment.value = answer.testEnvironment;
  localStorage.setItem(REMEMBERED_KEY, String(answer.testEnvironment));
}
// Offline, or a server that can't answer: the remembered answer stands.
void ask().catch(() => {});
</script>

<template>
  <UAlert
    v-if="testEnvironment && !closed"
    role="note"
    color="warning"
    variant="solid"
    icon="i-lucide-flask-conical"
    :title="$t('testEnvironment.banner')"
    close
    class="rounded-none py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]"
    @update:open="closed = true"
  />
</template>
