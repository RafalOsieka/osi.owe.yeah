import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { describeError, main } from '../src/cli.ts';

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { name: 'unset', env: {} },
    { name: 'blank', env: { DATABASE_URL: '   ' } },
  ])('fails fast naming DATABASE_URL when it is $name', async ({ env }) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(main(env)).resolves.toBe(1);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain('DATABASE_URL is not set');
  });

  it('reports a connection failure as exit code 1 with only the message', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Port 1 refuses connections immediately; no database is needed.
    await expect(
      main({ DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/db?connect_timeout=2' }),
    ).resolves.toBe(1);
    expect(error.mock.calls[0]).toEqual(['Migration failed:', expect.any(String)]);
  });
});

describe('describeError', () => {
  it('includes the messages of the cause chain', () => {
    const driverError = new Error('password authentication failed for user "postgres"');
    const wrapped = new Error('Failed query: CREATE SCHEMA', { cause: driverError });

    expect(describeError(wrapped)).toBe(
      'Failed query: CREATE SCHEMA\n  Caused by: password authentication failed for user "postgres"',
    );
  });

  it('stops on a cyclic cause', () => {
    const error = new Error('loop');
    error.cause = error;

    expect(describeError(error)).toBe('loop');
  });
});
