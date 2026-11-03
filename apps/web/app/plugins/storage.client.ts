// Asks the browser to keep the device store under storage pressure: Trips and changes not
// synced yet live only here until they sync (ADR 0002). Asked on app open once the device
// holds a Trip, so a first visit meets no permission prompt (Firefox asks). Browsers that
// decide on their own (Chrome grants it to an installed app) are asked on every open until
// they grant it.
export default defineNuxtPlugin(() => {
  const device = useDevice();

  async function persist(): Promise<void> {
    if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
    if ((await device.readAll()).length > 0) await navigator.storage.persist();
  }

  // Best effort: storage that isn't persisted still works, the browser may only clear it.
  void persist().catch(() => {});
});
