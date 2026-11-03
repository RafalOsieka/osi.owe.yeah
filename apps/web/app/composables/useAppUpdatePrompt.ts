// Whether the server answered "update needed": it speaks a newer sync schema than this app.
const updateNeeded = ref(false);

/** Whether the server needs a newer app to sync with; set by the sync transport on a 426. */
export function useUpdateNeeded(): Ref<boolean> {
  return updateNeeded;
}

/**
 * "New version, reload": a toast once a new version of the app waits to take over (its
 * service worker updated: checked on open and hourly while the app stays open), or once the
 * server answered "update needed". Reloading lets the new version take over; it migrates the
 * device store and sends the outbox again (ADR 0002). Until then, changes wait on this device.
 * Called once, by the app.
 */
export function useAppUpdatePrompt(): void {
  const { $pwa } = useNuxtApp();
  const toast = useToast();
  const { t } = useI18n();

  // The server runs a newer version already: look for it now, not at the next hourly check.
  watch(updateNeeded, (needed) => {
    if (needed) void $pwa?.getSWRegistration()?.update();
  });

  // Shown again, or told that changes wait, as either becomes so; even if dismissed before.
  watch(
    () => [!!$pwa?.needRefresh, updateNeeded.value] as const,
    ([waiting, needed]) => {
      if (!waiting && !needed) return;
      toast.add({
        id: 'app-update',
        title: t('appUpdate.title'),
        description: needed ? t('appUpdate.syncWaits') : undefined,
        icon: 'i-lucide-sparkles',
        duration: Infinity,
        actions: [{ label: t('appUpdate.reload'), onClick: reload }],
      });
    },
    { immediate: true },
  );

  async function reload(): Promise<void> {
    // A waiting service worker takes over and reloads the page.
    if ($pwa?.needRefresh) return $pwa.updateServiceWorker(true);
    // Only the server knows of the new version yet (the 426 is online): without the old
    // service worker, which would serve the old app again, the reload comes from the network
    // and registers the new one.
    await $pwa?.getSWRegistration()?.unregister();
    location.reload();
  }
}
