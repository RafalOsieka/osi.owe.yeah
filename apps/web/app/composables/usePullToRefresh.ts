// How far the page must be pulled down, in pixels, before letting go refreshes it.
const THRESHOLD = 64;

/**
 * Pull-to-refresh, as on a phone: dragging down from the very top of the page and letting
 * go past the threshold calls `refresh`. `pulled` is how far the page is pulled now, for
 * the indicator; `refreshing` is true until `refresh` settles.
 */
export function usePullToRefresh(refresh: () => Promise<void>) {
  const pulled = ref(0);
  const refreshing = ref(false);
  const ready = computed(() => pulled.value >= THRESHOLD);
  let startY: number | null = null;

  function start(event: TouchEvent): void {
    startY = window.scrollY === 0 && !refreshing.value ? event.touches[0]!.clientY : null;
  }

  function move(event: TouchEvent): void {
    if (startY === null) return;
    // Half the finger's travel, as the page resists the pull.
    pulled.value = Math.min(Math.max(0, (event.touches[0]!.clientY - startY) / 2), THRESHOLD * 1.5);
  }

  async function end(): Promise<void> {
    startY = null;
    if (!ready.value) {
      pulled.value = 0;
      return;
    }
    refreshing.value = true;
    pulled.value = 0;
    await refresh().finally(() => (refreshing.value = false));
  }

  onMounted(() => {
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', start);
    window.removeEventListener('touchmove', move);
    window.removeEventListener('touchend', end);
  });

  return { pulled, ready, refreshing };
}
