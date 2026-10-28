import { z } from 'zod';

/**
 * The currencies our rate provider (Frankfurter) covers. Only these can be a Trip currency,
 * so balances can always be worked out.
 */
export const TRIP_CURRENCIES = [
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
] as const;

export type TripCurrency = (typeof TRIP_CURRENCIES)[number];

/**
 * The request header that carries the Trip link's token, the only credential (ADR 0001).
 */
export const TRIP_TOKEN_HEADER = 'x-trip-token';

/** A Trip id: a UUIDv7 generated on the device, so a retried creation keeps its id. */
export const tripIdSchema = z.uuid({ version: 'v7' });

/** A Trip name: free text, trimmed, never blank. */
export const tripNameSchema = z.string().trim().min(1).max(100);

/** A Trip's details, as the client creates them and the whole-Trip pull returns them. */
export const tripSchema = z.object({
  id: tripIdSchema,
  name: tripNameSchema,
  currency: z.enum(TRIP_CURRENCIES),
});

export type Trip = z.infer<typeof tripSchema>;
