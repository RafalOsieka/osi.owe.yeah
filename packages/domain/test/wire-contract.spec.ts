import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';
import {
  SYNC_SCHEMA_HEADER,
  SYNC_SCHEMA_VERSION,
  TRIP_TOKEN_HEADER,
  environmentResponseSchema,
  pullQuerySchema,
  pullResponseSchema,
  pushEnvelopeSchema,
  pushKeyResponseSchema,
  pushMessageSchema,
  pushRequestSchema,
  pushResponseSchema,
  rateLookupSchema,
  rateQuerySchema,
  reminderRefusalSchema,
  reminderRequestSchema,
  reminderStatusSchema,
  revisionsResponseSchema,
  subscriptionRequestSchema,
} from '@osi/owe-yeah-domain';

/**
 * The wire contract: the request headers and every schema that crosses `/api` or Web Push, with
 * the sync schema version they ship under. Each side parses what it receives with these, and the
 * server answers an app on another version with 426 "update needed" (ADR 0002), so changing one
 * needs a decision before the snapshot is updated (`vp test run -u`):
 *
 * - Bump `SYNC_SCHEMA_VERSION` when an older app could break: a response the server can now
 *   send that the older app's schema refuses (a new problem code, currency or field value, a
 *   looser limit), or a request the older app sends that the new schema refuses (a new required
 *   field, a tighter limit, a renamed header). Every older app then has to update to sync again.
 * - Keep the version when the change is safe for older apps: a request schema that only accepts
 *   more (an optional field, a looser limit, a new enum value), or a response schema that only
 *   accepts less of what the server never sends anyway. A new response field is dropped by an
 *   older app, so it is safe only if losing it on that app's next push is.
 *
 * The Web Push payload never passes the version check: an installed service worker reads it as
 * its own app version wrote it, so a bump can't protect it. Only a change every installed worker
 * reads as before is safe there, such as a new field it ignores; a new `kind` or a changed field
 * needs the workers to handle it first. Path parameters are plain ids, not here. Refinements and
 * transforms (`.refine`, `.trim()`) don't show in JSON Schema: judge a change to them the same way.
 */
describe('the wire contract', () => {
  it('changes only together with a decision about the sync schema version', () => {
    expect({
      version: SYNC_SCHEMA_VERSION,
      headers: { syncSchema: SYNC_SCHEMA_HEADER, tripToken: TRIP_TOKEN_HEADER },
      // Sent by the app, parsed by the server.
      requests: accepted({
        // The push body is read as an envelope first, then change by change.
        pushEnvelope: pushEnvelopeSchema,
        pushBody: pushRequestSchema,
        pullQuery: pullQuerySchema,
        rateQuery: rateQuerySchema,
        subscriptionBody: subscriptionRequestSchema,
        reminderBody: reminderRequestSchema,
      }),
      // Sent by the server, parsed by the app or its service worker.
      responses: accepted({
        push: pushResponseSchema,
        pull: pullResponseSchema,
        revisions: revisionsResponseSchema,
        rates: rateLookupSchema,
        reminderStatus: reminderStatusSchema,
        reminderRefusal: reminderRefusalSchema,
        vapidKey: pushKeyResponseSchema,
        environment: environmentResponseSchema,
        webPush: pushMessageSchema,
      }),
    }).toMatchSnapshot();
  });
});

/** Each schema as JSON Schema of what its parser accepts, which is what the other side sends. */
function accepted(schemas: Record<string, z.ZodType>) {
  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: 'input' }),
    ]),
  );
}
