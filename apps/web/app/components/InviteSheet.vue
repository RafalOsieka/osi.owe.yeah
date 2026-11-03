<script setup lang="ts">
// Invite: passes on the Trip link to someone joining the Trip, by a QR code made on this
// device (no signal needed), the share sheet, or copying it where there is no share sheet.
// Only once the Trip has synced (`link` set): until the server has the Trip, its link opens
// nothing, so the sheet says why instead.
const open = defineModel<boolean>('open', { required: true });
const { tripName, link } = defineProps<{ tripName: string; link: string | null }>();

const { t } = useI18n();
const toast = useToast();
const canShare = 'share' in navigator;

async function share(url: string): Promise<void> {
  try {
    await navigator.share({ title: tripName, url });
  } catch (error) {
    // Closed without sharing; anything else, e.g. a refused share, falls back to copying.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    await copy(url);
  }
}

async function copy(url: string): Promise<void> {
  await navigator.clipboard.writeText(url);
  toast.add({ title: t('invite.copied'), icon: 'i-lucide-check' });
}
</script>

<template>
  <UDrawer
    v-model:open="open"
    :title="$t('invite.title', { name: tripName })"
    :description="$t('invite.help')"
  >
    <template #body>
      <div v-if="link">
        <QrCode :text="link" :label="$t('invite.qr')" class="mx-auto block w-full max-w-64" />
        <p class="mt-3 text-center text-sm text-muted">{{ $t('invite.qrHelp') }}</p>
      </div>
      <UAlert
        v-else
        color="neutral"
        variant="subtle"
        icon="i-lucide-cloud-off"
        :title="$t('invite.notSynced')"
        :description="$t('invite.notSyncedHelp')"
      />
    </template>
    <template v-if="link" #footer>
      <UButton
        v-if="canShare"
        block
        icon="i-lucide-share-2"
        :label="$t('invite.share')"
        @click="share(link)"
      />
      <UButton v-else block icon="i-lucide-copy" :label="$t('invite.copy')" @click="copy(link)" />
    </template>
  </UDrawer>
</template>
