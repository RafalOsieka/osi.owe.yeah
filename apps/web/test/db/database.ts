import { runMigrations } from '@osi/owe-yeah-migrator';
import { afterAll, beforeAll } from 'vitest';
import { createDatabaseClient, type Database, type DatabaseClient } from '../../server/db/client';
import { provisionEmptyDatabase } from '../e2e/harness/postgres';

/**
 * A fresh database with every committed migration applied, for the test file calling this:
 * created before its first test and closed after its last. Call it inside the file's
 * `describeWithDocker()` block, so it is skipped with the tests. Returns the database to use
 * once the tests run.
 */
export function useMigratedDatabase(): () => Database {
  let client: DatabaseClient | undefined;

  beforeAll(async () => {
    const url = await provisionEmptyDatabase();
    await runMigrations(url);
    client = createDatabaseClient(url, 4);
  });

  afterAll(async () => {
    await client?.sql.end({ timeout: 5 });
  });

  return () => {
    if (!client) throw new Error('The database is ready only once the tests run');
    return client.db;
  };
}
