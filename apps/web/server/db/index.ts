import { createDatabaseClient, type Database, type DatabaseClient } from './client';

let client: DatabaseClient | undefined;

/**
 * The shared Drizzle client of the Nitro server (one pool per process). The first
 * call creates the pool and fails fast when `DATABASE_URL` is missing; later calls
 * reuse it. All server-side database access goes through this getter.
 */
export function getDb(): Database {
  client ??= createDatabaseClient();
  return client.db;
}

export { createDatabaseClient, resolveDatabaseUrl } from './client';
