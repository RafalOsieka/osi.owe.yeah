import { runMigrations } from '@osi/owe-yeah-migrator';
import type { TestProject } from 'vitest/node';
import { isDockerAvailable, provisionEmptyDatabase, startPostgres, stopPostgres } from './postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    // A migrated database for the app server under test; unset when Docker is missing.
    databaseUrl?: string;
  }
}

// Without Docker the suites skip locally (and fail in CI), see `describeWithDocker`.
export async function setup(project: TestProject): Promise<void> {
  if (!isDockerAvailable()) return;

  await startPostgres();
  const databaseUrl = await provisionEmptyDatabase();
  await runMigrations(databaseUrl);
  project.provide('databaseUrl', databaseUrl);
}

export function teardown(): void {
  if (isDockerAvailable()) stopPostgres();
}
