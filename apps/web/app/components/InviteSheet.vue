<script setup lang="ts">
// Invite: passes on the Trip link to someone joining the Trip, by a QR code made on this
// device (no signal needed), the share sheet, or copying the link, which the sheet shows
// shortened. Only once the Trip has synced (`link` set): until the server has the Trip, its link
// opens nothing, so the sheet says why instead. Done closes it.
const open = defineModel<boolean>('open', { required: true });
const { tripName, link } = defineProps<{ tripName: string; link: string | null }>();

const { t } = useI18n();
const toast = useToast();
const canShare = 'share' in navigator;

// The link without its scheme, e.g. "oweyeah.app/trips/0193…", ellipsed by the layout.
const shownLink = computed(() => link?.replace(/^https?:\/\//, '') ?? '');

async function share(url: string): Promise<void> {
  try {
    await navigator.share({ title: tripName, url });
  } catch (error) {
    // Closed without sharing; anything else, e.g. a refused share, falls back to copying.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    await copy(url);
  }
}

// The clipboard may be refused, e.g. while the page isn't focused: then the user hears it.
async function copy(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.add({ title: t('invite.copied'), icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('invite.copyFailed'), color: 'error' });
  }
}
</script>

<template>
  <UDrawer
    v-model:open="open"
    :title="$t('invite.title', { name: tripName })"
    :description="$t('invite.help')"
    :ui="{ description: 'text-pretty' }"
  >
    <template #body>
      <div v-if="link" class="space-y-4">
        <!-- Framed the same in both color modes: a white plate holding the code. -->
        <figure class="mx-auto w-full max-w-60">
          <QrCode :text="link" :label="$t('invite.qr')" class="block w-full ring-1 ring-default" />
          <figcaption class="mt-2.5 text-center text-sm text-muted">
            {{ $t('invite.qrHelp') }}
          </figcaption>
        </figure>
        <div class="flex items-center gap-2 rounded-xl bg-elevated/60 py-1 ps-3.5 pe-1">
          <UIcon name="i-lucide-link" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-sm text-toned">{{ shownLink }}</span>
          <UButton
            variant="ghost"
            icon="i-lucide-copy"
            :label="$t('invite.copyShort')"
            :aria-label="$t('invite.copy')"
            @click="copy(link)"
          />
        </div>
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
    <template #footer>
      <UButton
        v-if="link && canShare"
        block
        size="xl"
        icon="i-lucide-share-2"
        :label="$t('invite.share')"
        @click="share(link)"
      />
      <UButton
        variant="ghost"
        color="neutral"
        block
        :label="$t('form.done')"
        @click="open = false"
      />
    </template>
  </UDrawer>
</template>
