import {
  pullResponseSchema,
  pushResponseSchema,
  reminderRefusalSchema,
  reminderStatusSchema,
  revisionsResponseSchema,
  TRIP_TOKEN_HEADER,
} from '@osi/owe-yeah-domain';
import { DeviceDb } from '~/sync/db';
import { createDevice, type Device, type Transport } from '~/sync/device';

/** The sync API over `syncApi`. Answers are checked before they reach the device store. */
export const httpTransport: Transport = {
  async push(tripId, token, request) {
    const response = await syncApi(`/api/trips/${tripId}/push`, {
      method: 'POST',
      headers: { [TRIP_TOKEN_HEADER]: token },
      body: request,
    });
    return pushResponseSchema.parse(response);
  },
  async pull(tripId, token, since) {
    const response = await syncApi.raw(`/api/trips/${tripId}`, {
      headers: { [TRIP_TOKEN_HEADER]: token },
      query: since === undefined ? {} : { since },
      ignoreResponseError: true,
    });
    if (response.status === 401) return 'invalidLink';
    if (!response.ok) throw new Error(`Pull failed with ${response.status}`);
    return pullResponseSchema.parse(response._data);
  },
  async revisions(tripId, token, expenseId) {
    const response = await syncApi(`/api/trips/${tripId}/expenses/${expenseId}/revisions`, {
      headers: { [TRIP_TOKEN_HEADER]: token },
    });
    return revisionsResponseSchema.parse(response).revisions;
  },
  async subscribe(tripId, token, deviceId, request) {
    await syncApi(`/api/trips/${tripId}/subscriptions/${deviceId}`, {
      method: 'PUT',
      headers: { [TRIP_TOKEN_HEADER]: token },
      body: request,
    });
  },
  async unsubscribe(tripId, token, deviceId) {
    const response = await syncApi.raw(`/api/trips/${tripId}/subscriptions/${deviceId}`, {
      method: 'DELETE',
      headers: { [TRIP_TOKEN_HEADER]: token },
      ignoreResponseError: true,
    });
    if (!response.ok && response.status !== 401) {
      throw new Error(`Unsubscribe failed with ${response.status}`);
    }
  },
  async reminderStatus(tripId, token) {
    const response = await syncApi(`/api/trips/${tripId}/reminders`, {
      headers: { [TRIP_TOKEN_HEADER]: token },
    });
    return reminderStatusSchema.parse(response);
  },
  async remind(tripId, token, request) {
    const response = await syncApi.raw(`/api/trips/${tripId}/reminders`, {
      method: 'POST',
      headers: { [TRIP_TOKEN_HEADER]: token },
      body: request,
      ignoreResponseError: true,
    });
    if (response.ok) return 'sent';
    // Only the server's own refusals name one (`server/utils/reminders.ts`): a WAF block or a
    // rate limit in front of it answers 403 or 429 too, and is no refusal.
    const refusal = reminderRefusalSchema.safeParse(response._data);
    if (!refusal.success) throw new Error(`Reminder failed with ${response.status}`);
    return refusal.data.refused;
  },
};

const DEVICE_ID_KEY = 'owe-yeah:device-id';

/** This device's opaque id, made once and sent with every change for display only. */
function deviceId(): string {
  const known = localStorage.getItem(DEVICE_ID_KEY);
  if (known) return known;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

let device: Device | undefined;

/** The device's Trips, outbox and sync, shared by the whole app (see `createDevice`). */
export function useDevice(): Device {
  device ??= createDevice(new DeviceDb(), httpTransport, deviceId());
  return device;
}
