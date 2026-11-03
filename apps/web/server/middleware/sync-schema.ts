import { SYNC_SCHEMA_HEADER, SYNC_SCHEMA_VERSION } from '@osi/owe-yeah-domain';
import { createError, defineEventHandler, getRequestHeader, getRequestURL } from 'nuxt/server';

/**
 * The server speaks only the newest sync schema (ADR 0002): an API request in any other, or
 * from an app from before it sent one, is answered 426 "update needed" before it is read.
 * The app then updates, migrates what it keeps and sends its outbox again.
 */
export default defineEventHandler((event) => {
  if (!getRequestURL(event).pathname.startsWith('/api/')) return;
  if (getRequestHeader(event, SYNC_SCHEMA_HEADER) === String(SYNC_SCHEMA_VERSION)) return;
  throw createError({ status: 426, statusText: 'Update needed' });
});
