import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe } from 'vitest';

const CONTAINER_NAME = 'osi-owe-yeah-e2e-pg';
const HOST_PORT = 54810;
const SERVER_URL = `postgres://postgres:postgres@127.0.0.1:${HOST_PORT}`;
const ADMIN_URL = `${SERVER_URL}/postgres`;

/** Returns true when a usable Docker CLI is available on the host. */
export function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * `describe` when Docker is available, `describe.skip` locally without it.
 * In CI a missing Docker fails the suite instead of skipping it silently.
 */
export function describeWithDocker(): typeof describe | typeof describe.skip {
  if (isDockerAvailable()) return describe;
  if (process.env.CI)
    throw new Error('Docker is required in CI (skipping is only allowed locally)');
  return describe.skip;
}

/** Starts a disposable `postgres:18-alpine` container and waits until it accepts queries. */
export async function startPostgres(): Promise<void> {
  stopPostgres();
  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      CONTAINER_NAME,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-p',
      `${HOST_PORT}:5432`,
      'postgres:18-alpine',
    ],
    { stdio: 'ignore' },
  );

  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    try {
      await sql`SELECT 1`;
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  throw new Error(`Postgres did not become ready in time: ${String(lastError)}`);
}

/** Stops and removes the disposable Postgres container, if it exists. */
export function stopPostgres(): void {
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
  } catch {
    // Nothing to remove.
  }
}

/** Creates a fresh, empty database and returns its URL, so each test starts unmigrated. */
export async function provisionEmptyDatabase(): Promise<string> {
  const name = `owe_yeah_${randomUUID().replaceAll('-', '_')}`;
  const sql = postgres(ADMIN_URL, { max: 1 });

  try {
    await sql.unsafe(`CREATE DATABASE "${name}"`);
    return `${SERVER_URL}/${name}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
