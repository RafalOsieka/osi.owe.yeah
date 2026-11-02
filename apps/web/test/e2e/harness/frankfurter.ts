import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Frankfurter at the HTTP boundary, serving `GET /v2/rates?base&quotes&from&to`
 * as the real one does: a row per date in the range that it has a rate for. Rates are set by
 * `set` and can be changed later, as the provider may; a currency it has no rate for at all
 * answers 422. Every request it got is kept, so a test can tell what the server fetched.
 */
export async function startFrankfurter() {
  // `date base quote` → rate.
  const rates = new Map<string, number>();
  const requests: URLSearchParams[] = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const query = url.searchParams;
    requests.push(query);
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // SAFETY: a server listening on a TCP port has an `AddressInfo` address.
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** Sets the rate of one unit of `base` in `quote` on `date`. */
    set(date: string, base: string, quote: string, rate: number): void {
      rates.set(`${date} ${base} ${quote}`, rate);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
