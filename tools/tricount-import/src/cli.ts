import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { roundMoney, type Rational } from '@osi/owe-yeah-domain';
import { fetchTricount, shareToken } from './api.ts';
import { importTricount } from './mapping.ts';
import { parseTricount } from './tricount.ts';
import { BalanceMismatchError, writeTrip } from './write.ts';

const USAGE = `Moves a Tricount into a new Trip, once.

  DATABASE_URL=… pnpm --filter @osi/owe-yeah-tricount-import import -- \\
    (<Tricount share link> | --from-file <saved response>) \\
    --zone <IANA zone, e.g. Europe/Warsaw> --origin <app URL, e.g. https://owe.example.com>

Entry times are read as local time in --zone. A fetched response is saved to responses/
first, without the share token, so --from-file can import it again.`;

/** Where each run saves the response it fetched. Git ignores the folder. */
const RESPONSES = fileURLToPath(new URL('../responses/', import.meta.url));

/**
 * Imports one Tricount and returns the process exit code. `DATABASE_URL` must be set
 * explicitly: no `.env` is read, so the target is never a surprise. On success it prints the
 * new Trip link; on a balance mismatch nothing is written and the differences are printed.
 */
export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const fail = (problem: string) => {
    console.error(`${problem}\n\n${USAGE}`);
    return 1;
  };
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'from-file': { type: 'string' },
        zone: { type: 'string' },
        origin: { type: 'string' },
      },
    });
  } catch (error) {
    return fail(describeError(error));
  }
  const { zone, origin, 'from-file': fromFile } = args.values;
  const [link, ...extra] = args.positionals;
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) return fail('DATABASE_URL is not set');
  if (!zone || !isTimeZone(zone)) return fail('--zone must be an IANA time zone');
  if (!origin || !URL.canParse(origin)) return fail('--origin must be the URL the app runs at');
  if ((link === undefined) === (fromFile === undefined) || extra.length > 0) {
    return fail('Give either a share link or --from-file');
  }

  try {
    const raw = fromFile ? await readFile(fromFile, 'utf8') : await fetchAndSave(link!);
    const imported = importTricount(parseTricount(raw), zone);
    const { trip, expenses, skipped } = imported;
    console.log(
      `"${trip.name}": ${trip.participants.length} Participants, ${expenses.length} Expenses` +
        ` (${skipped} entries skipped), in ${trip.currency}.`,
    );
    const token = await writeTrip(databaseUrl, imported);
    console.log(`Imported. Trip link:\n${new URL(`/trips/${trip.id}#${token}`, origin).href}`);
    return 0;
  } catch (error) {
    console.error('Import failed, nothing was written:', describeError(error));
    if (error instanceof BalanceMismatchError) {
      const amount = (value: Rational) => roundMoney(value, error.currency).decimal;
      for (const { participant, imported, tricount } of error.mismatches) {
        console.error(
          `  ${participant.name}: ${amount(imported)} here, ${amount(tricount)} in Tricount`,
        );
      }
    }
    return 1;
  }
}

/**
 * Fetches the Tricount and saves the response as received before anything else reads it, with
 * the share token taken out wherever it appears, so a run that fails later can be repeated
 * with `--from-file`.
 */
async function fetchAndSave(link: string): Promise<string> {
  const raw = await fetchTricount(link);
  await mkdir(RESPONSES, { recursive: true });
  const file = resolve(RESPONSES, `${new Date().toISOString().replaceAll(':', '-')}.json`);
  await writeFile(file, raw.replaceAll(shareToken(link), '[redacted]'));
  console.log(`Saved the response to ${file}`);
  return raw;
}

/** Whether `zone` is an IANA time zone the runtime knows. */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** An error's message and those of its `cause` chain. */
function describeError(cause: unknown): string {
  const messages: string[] = [];
  for (let current = cause; current !== undefined;) {
    messages.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join('\n  Caused by: ');
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
