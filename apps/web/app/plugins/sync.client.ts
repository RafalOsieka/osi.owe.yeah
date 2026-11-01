// Syncs on its own (ADR 0002): every Trip on app open; on focus, on reconnect and about every
// 30 s while visible, the open Trip and any Trip with changes not synced yet. Pages sync a
// Trip after a local change and on pull-to-refresh.
export default defineNuxtPlugin(() => {
  const device = useDevice();
  const router = useRouter();

  async function syncTrips(all: boolean): Promise<void> {
    const open = router.currentRoute.value.params.id;
    for (const { deviceTrip: trip, unsynced } of await device.readAll()) {
      if (all || unsynced > 0 || trip.id === open) void device.sync(trip.id);
    }
  }
  const visible = () => document.visibilityState === 'visible';
  const syncSome = () => void syncTrips(false);

  void syncTrips(true);
  window.addEventListener('online', syncSome);
  window.addEventListener('focus', syncSome);
  document.addEventListener('visibilitychange', () => visible() && syncSome());
  setInterval(() => visible() && syncSome(), 30_000);
});
