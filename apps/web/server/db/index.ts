import { createDatabaseClient, type Database, type DatabaseClient } from './client';

let client: DatabaseClient | undefined;

/**
 * The shared Drizzle client of the Nitro server (one pool per process). The first
 * call creates the pool and fails fast when `DATABASE_URL` is missing; later calls
 * reuse it. The Trip modules' composition root (`server/trip/index.ts`) hands it to the
 * modules it builds; only handlers outside them call it themselves.
 */
export function getDb(): Database {
  client ??= createDatabaseClient();
  return client.db;
}
