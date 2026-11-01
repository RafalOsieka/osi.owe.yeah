import { z } from 'zod';
import { participantSchema } from './participant.ts';

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

/**
 * A Trip link's token: 256 random bits, base64url. The device that creates the Trip
 * generates it, so a Trip can be created offline and a retried creation keeps its token;
 * the server keeps only its hash.
 */
export const tripTokenSchema = z.string().regex(/^[\w-]{43}$/);

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

/**
 * A Trip with its Participants, as the client creates it and the whole-Trip pull returns
 * it. Participant names may repeat; ids may not.
 */
export const tripWithParticipantsSchema = tripSchema.extend({
  participants: z
    .array(participantSchema)
    .max(100)
    .refine(
      (participants) => new Set(participants.map(({ id }) => id)).size === participants.length,
      {
        message: 'Participant ids must be unique',
      },
    ),
});

export type TripWithParticipants = z.infer<typeof tripWithParticipantsSchema>;
