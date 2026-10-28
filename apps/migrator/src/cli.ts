import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './index.ts';

/**
 * The one-shot migrate step: applies pending migrations to `DATABASE_URL` and
 * returns the process exit code. Only error messages are printed, never error
 * objects, which could carry connection details.
 */
export async function main(env: NodeJS.ProcessEnv): Promise<number> {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    console.error('Migration failed: DATABASE_URL is not set. Define it (see .env.example).');
    return 1;
  }

  try {
    await runMigrations(databaseUrl);
    console.log('Migrations applied successfully.');
    return 0;
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  // Local runs pick up the repository `.env`; in Docker the file is absent and
  // compose provides the environment. Existing variables are never overridden.
  const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  process.exitCode = await main(process.env);
}
