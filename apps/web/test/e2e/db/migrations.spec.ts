import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@osi/owe-yeah-migrator';
import { beforeEach, expect, it } from 'vitest';
import { createDatabaseClient } from '../../../server/db/client';
import { trips } from '../../../server/db/schema';
import { describeWithDocker, provisionEmptyDatabase } from '../harness/postgres';

const describeDb = describeWithDocker();

/** Writes a one-migration folder in Drizzle's journal format and returns its path. */
function writeMigration(statement: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'owe-yeah-migrations-'));
  mkdirSync(join(dir, 'meta'));
  writeFileSync(join(dir, '0000_test.sql'), statement);
  const entry = { idx: 0, version: '7', when: Date.now(), tag: '0000_test', breakpoints: true };
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries: [entry] }),
  );
  return dir;
}

describeDb('committed migrations', () => {
  let databaseUrl: string;

  beforeEach(async () => {
    databaseUrl = await provisionEmptyDatabase();
  });

  it('create a schema the Drizzle tables can write to and read from', async () => {
    await runMigrations(databaseUrl);

    const { db, sql } = createDatabaseClient(databaseUrl, 1);
    try {
      const id = '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b';
      await db
        .insert(trips)
        .values({ id, name: 'Croatia 2026', currency: 'EUR', tokenHash: 'croatia' });

      const [trip] = await db.select().from(trips);
      expect(trip).toMatchObject({ id, name: 'Croatia 2026', currency: 'EUR' });
      expect(trip?.createdAt).toBeInstanceOf(Date);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('give a Trip inserted without an id a UUIDv7, and bump updatedAt on update', async () => {
    await runMigrations(databaseUrl);

    const { db, sql } = createDatabaseClient(databaseUrl, 1);
    try {
      const [created] = await db
        .insert(trips)
        .values({ name: 'Tatry', currency: 'PLN', tokenHash: 'tatry' })
        .returning();
      // The version nibble (first of the third group) is 7 for UUIDv7.
      expect(created?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);

      const [updated] = await db.update(trips).set({ name: 'Tatry 2026' }).returning();
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(created?.updatedAt.getTime() ?? 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('apply nothing on a second run', async () => {
    await runMigrations(databaseUrl);
    const { sql } = createDatabaseClient(databaseUrl, 1);
    try {
      const countApplied = async () =>
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0]
          ?.n;
      const afterFirstRun = await countApplied();

      await runMigrations(databaseUrl);

      expect(afterFirstRun).toBeGreaterThan(0);
      expect(await countApplied()).toBe(afterFirstRun);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('reject a broken migration', async () => {
    const dir = writeMigration('THIS IS NOT SQL;');
    try {
      await expect(runMigrations(databaseUrl, dir)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
