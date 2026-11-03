import { SYNC_SCHEMA_HEADER, SYNC_SCHEMA_VERSION } from '@osi/owe-yeah-domain';

/**
 * `$fetch` for the sync API: says which sync schema this app speaks, and notes when the server
 * answers "update needed" (426) as it speaks a newer one (`useUpdateNeeded`). The request
 * fails all the same, so the outbox waits for the new version.
 */
export const syncApi = $fetch.create({
  headers: { [SYNC_SCHEMA_HEADER]: String(SYNC_SCHEMA_VERSION) },
  onResponse({ response }) {
    if (response.status === 426) useUpdateNeeded().value = true;
  },
});
