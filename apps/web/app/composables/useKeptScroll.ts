// Where each Trip tab was scrolled to when the user last left it, by path.
const positions = new Map<string, number>();

/**
 * Keeps a Trip tab's scroll position while the user switches tabs, as phone apps do. The
 * page must set `scrollToTop: false` in its meta, leaving the scrolling to this.
 */
export function useKeptScroll(): void {
  const { path } = useRoute();
  onBeforeRouteLeave(() => {
    positions.set(path, window.scrollY);
  });
  onMounted(() => window.scrollTo({ top: positions.get(path) ?? 0 }));
}
