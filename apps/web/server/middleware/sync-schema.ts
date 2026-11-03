import { SYNC_SCHEMA_HEADER, SYNC_SCHEMA_VERSION } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, getRequestHeader, getRequestURL } from 'nuxt/server';

/**
 * The server speaks only the newest sync schema (ADR 0002): an API request in an older one, or
 * from an app from before it sent one, is answered 426 "update needed" before it is read.
 * The app then updates, migrates what it keeps and sends its outbox again. An app newer than
 * the server (after a rollback) is refused too, but not told to update: its outbox waits.
 */
export default defineEventHandler((event) => {
  if (!getRequestURL(event).pathname.startsWith('/api/')) return;
  const spoken = Number(getRequestHeader(event, SYNC_SCHEMA_HEADER) ?? 0);
  if (spoken === SYNC_SCHEMA_VERSION) return;
  if (spoken > SYNC_SCHEMA_VERSION) {
    throw createError({ status: 409, statusText: 'Sync schema newer than the server' });
  }
  throw createError({ status: 426, statusText: 'Update needed' });
});
