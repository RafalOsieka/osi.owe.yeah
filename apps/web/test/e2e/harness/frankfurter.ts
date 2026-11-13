import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * The ui suite's port for the stand-in, fixed so that `playwright.config.ts` can point the servers
 * it starts here. Below the dynamic port range, next to the suite's PostgreSQL.
 */
export const UI_FRANKFURTER_PORT = 25811;

/**
 * A stand-in for Frankfurter at the HTTP boundary, serving `GET /v2/rates?base&quotes&from&to`
 * as the real one does: a row per date in the range that it has a rate for. Rates are set by
 * `set` and can be changed later, as the provider may; a currency it has no rate for at all
 * answers 422. Every request it got is kept, so a test can tell what the server fetched. While
 * `hold` is in force it answers nothing, as a slow provider. Listens on `port`, or on any free
 * one by default.
 */
export async function startFrankfurter(port = 0) {
  // `date base quote` → rate.
  const rates = new Map<string, number>();
  const requests: URLSearchParams[] = [];
  // Settles when the current hold is released.
  let held = Promise.resolve();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const query = url.searchParams;
    requests.push(query);
    await held;
    const base = query.get('base')?.toUpperCase() ?? 'EUR';
    const quotes = (query.get('quotes') ?? '').toUpperCase().split(',');
    const [from, to] = [query.get('from') ?? '', query.get('to') ?? ''];
    const known = [...rates.keys()].some((key) => key.split(' ')[1] === base);

    response.setHeader('content-type', 'application/json');
    if (url.pathname !== '/v2/rates' || !known) {
      response.statusCode = 422;
      response.end(JSON.stringify({ status: 422, message: `invalid currency: ${base}` }));
      return;
    }
    const rows = [...rates]
      .map(([key, rate]) => {
        const [date = '', rowBase, quote] = key.split(' ');
        return { date, base: rowBase, quote, rate };
      })
      .filter(
        (row) =>
          row.base === base &&
          quotes.includes(row.quote ?? '') &&
          row.date >= from &&
          row.date <= to,
      )
      .toSorted((a, b) => a.date.localeCompare(b.date));
    response.end(JSON.stringify(rows));
  });
  // A fixed port may be taken: that rejects instead of waiting for ever.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  // SAFETY: a server listening on a TCP port has an `AddressInfo` address.
  const { port: listening } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${listening}`,
    requests,
    /** Sets the rate of one unit of `base` in `quote` on `date`. */
    set(date: string, base: string, quote: string, rate: number): void {
      rates.set(`${date} ${base} ${quote}`, rate);
    },
    /** Holds every answer from now on until the returned release is called. */
    hold(): () => void {
      let release = () => {};
      held = new Promise<void>((resolve) => (release = resolve));
      return () => release();
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
