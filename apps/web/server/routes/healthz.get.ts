import { sql } from 'drizzle-orm';
import { createError, defineEventHandler, useRuntimeConfig } from 'nuxt/server';
import { getDb } from '../db';

/**
 * Whether the server is up, and which build it runs: CI polls it until a deploy reports the
 * new commit (ADR 0005). Outside `/api`, so it needs no sync-schema header; it stays behind
 * the rate limiter like everything else. 503 while the database doesn't answer.
 */
export default defineEventHandler(async () => {
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    throw createError({ status: 503, statusText: 'Database unavailable' });
  }
  return { commit: useRuntimeConfig().commitSha };
});
