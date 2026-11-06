/**
 * How this browser can install the app: through its own prompt (`prompt`), by the Share → Add to
 * Home Screen steps on iOS, where Safari has no prompt (`homeScreen`), or not at all (`null`:
 * already installed, or a browser that offers no install).
 */
export type InstallOffer = 'prompt' | 'homeScreen' | null;

/**
 * The install offer the nudge on My Trips and the Install row on the Trip tab share, and
 * `install()`, which opens the browser's prompt.
 */
export function useInstallOffer() {
  const pwa = usePWA();
  const ios = isIos(navigator);

  const offer = computed<InstallOffer>(() => {
    if (!pwa || pwa.isPWAInstalled) return null;
    if (pwa.showInstallPrompt) return 'prompt';
    return ios ? 'homeScreen' : null;
  });

  return { offer, install: () => pwa?.install() };
}
