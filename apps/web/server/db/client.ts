import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

/**
 * Resolves the database connection string from the environment, failing fast
 * with a clear error when it is missing or empty.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Define it (see .env.example) before accessing the database.',
    );
  }

  return url;
}

export type Database = PostgresJsDatabase<typeof schema>;

export type DatabaseClient = {
  db: Database;
  sql: Sql;
};

/**
 * Creates a Drizzle client backed by its own postgres.js pool. Columns are
 * camelCase in TypeScript and snake_case in Postgres, matching `drizzle.config.ts`.
 * Exposed for tests; server code uses the shared `getDb()` from `./index`.
 */
export function createDatabaseClient(
  connectionString: string = resolveDatabaseUrl(),
  max = 10,
): DatabaseClient {
  const sql = postgres(connectionString, { max });
  const db = drizzle(sql, { schema, casing: 'snake_case' });

  return { db, sql };
}
