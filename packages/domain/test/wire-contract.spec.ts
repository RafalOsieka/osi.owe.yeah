import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';
import {
  SYNC_SCHEMA_VERSION,
  environmentResponseSchema,
  pullResponseSchema,
  pushKeyResponseSchema,
  pushMessageSchema,
  pushRequestSchema,
  pushResponseSchema,
  rateLookupSchema,
  reminderRefusalSchema,
  reminderRequestSchema,
  reminderStatusSchema,
  revisionsResponseSchema,
  subscriptionRequestSchema,
} from '@osi/owe-yeah-domain';

/**
 * The wire contract: every schema that crosses `/api` or Web Push, with the sync schema version
 * it ships under. Both sides parse what they receive strictly, and the server answers an app on
 * another version with 426 "update needed" (ADR 0002), so changing one of these schemas needs a
 * decision before the snapshot is updated (`vp test run -u`):
 *
 * - Bump `SYNC_SCHEMA_VERSION` when an older app could break: a response the server can now
 *   send that the older app's schema refuses (a new problem code, currency or field value, a
 *   looser limit), or a request the older app sends that the new schema refuses (a new required
 *   field, a tighter limit). Every older app then has to update before it syncs again.
 * - Keep the version when the change is safe for older apps: a request schema that only accepts
 *   more (an optional field, a looser limit, a new enum value), or a response schema that only
 *   accepts less of what the server never sends anyway. A new response field is dropped by an
 *   older app, so it is safe only if losing it on that app's next push is.
 *
 * The Web Push payload never passes the version check: an installed service worker reads it as
 * it is, so treat it as a response the version can't protect. Refinements (`.refine`) don't
 * show in JSON Schema: a changed refinement isn't caught here, so judge it the same way.
 */
const wire = {
  version: SYNC_SCHEMA_VERSION,
  // Sent by the app, parsed by the server.
  requests: {
    push: pushRequestSchema,
    subscription: subscriptionRequestSchema,
    reminder: reminderRequestSchema,
  },
  // Sent by the server, parsed by the app or its service worker.
  responses: {
    push: pushResponseSchema,
    pull: pullResponseSchema,
    revisions: revisionsResponseSchema,
    rates: rateLookupSchema,
    reminderStatus: reminderStatusSchema,
    reminderRefusal: reminderRefusalSchema,
    vapidKey: pushKeyResponseSchema,
    environment: environmentResponseSchema,
    webPush: pushMessageSchema,
  },
};

/** Each schema as JSON Schema of what its parser accepts, which is what the other side sends. */
const accepted = (schemas: Record<string, z.ZodType>) =>
  Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: 'input' }),
    ]),
  );

describe('the wire contract', () => {
  it('changes only together with a decision about the sync schema version', () => {
    expect({
      version: wire.version,
      requests: accepted(wire.requests),
      responses: accepted(wire.responses),
    }).toMatchSnapshot();
  });
});
