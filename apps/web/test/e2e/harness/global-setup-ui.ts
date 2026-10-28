import { runMigrations } from '@osi/owe-yeah-migrator';
import { DEFAULT_DATABASE_URL, isDockerAvailable, startPostgres, stopPostgres } from './postgres';

// Playwright cannot skip a whole run, so the ui suite needs Docker locally too.
export default async function setup(): Promise<() => void> {
  if (!isDockerAvailable()) throw new Error('Docker is required for the ui e2e suite');

  await startPostgres();
  await runMigrations(DEFAULT_DATABASE_URL);

  return stopPostgres;
}
