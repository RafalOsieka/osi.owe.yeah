import { runMigrations } from '@osi/owe-yeah-migrator';
import { startFrankfurter, UI_FRANKFURTER_PORT } from './frankfurter';
import { DEFAULT_DATABASE_URL, isDockerAvailable, startPostgres, stopPostgres } from './postgres';

// Playwright cannot skip a whole run, so the ui suite needs Docker locally too. The servers
// get their rates from the Frankfurter stand-in (`playwright.config.ts`), which has none: an
// Expense in another currency than the Trip's always needs a Manual rate.
export default async function setup(): Promise<() => Promise<void>> {
  if (!isDockerAvailable()) throw new Error('Docker is required for the ui e2e suite');

  // First: a taken port fails here, before there is a container to leave behind.
  const frankfurter = await startFrankfurter(UI_FRANKFURTER_PORT);
  await startPostgres();
  await runMigrations(DEFAULT_DATABASE_URL);

  return async () => {
    await frankfurter.close();
    stopPostgres();
  };
}
