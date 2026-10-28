import { isDockerAvailable, startPostgres, stopPostgres } from './postgres';

// Without Docker the db suites skip locally (and fail in CI), see `describeWithDocker`.
export async function setup(): Promise<void> {
  if (isDockerAvailable()) await startPostgres();
}

export function teardown(): void {
  if (isDockerAvailable()) stopPostgres();
}
