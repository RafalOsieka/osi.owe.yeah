import {
  pullResponseSchema,
  pushResponseSchema,
  revisionsResponseSchema,
  TRIP_TOKEN_HEADER,
} from '@osi/owe-yeah-domain';
import { DeviceDb } from '~/sync/db';
import { createDevice, type Device, type Transport } from '~/sync/device';

/** The sync API over `$fetch`. Answers are checked before they reach the device store. */
const transport: Transport = {
  async push(tripId, token, request) {
    const response = await $fetch(`/api/trips/${tripId}/push`, {
      method: 'POST',
      headers: { [TRIP_TOKEN_HEADER]: token },
      body: request,
    });
    return pushResponseSchema.parse(response);
  },
  async pull(tripId, token, since) {
    const response = await $fetch.raw(`/api/trips/${tripId}`, {
      headers: { [TRIP_TOKEN_HEADER]: token },
      query: since === undefined ? {} : { since },
      ignoreResponseError: true,
    });
    if (response.status === 401) return 'invalidLink';
    if (!response.ok) throw new Error(`Pull failed with ${response.status}`);
    return pullResponseSchema.parse(response._data);
  },
  async revisions(tripId, token, expenseId) {
    const response = await $fetch(`/api/trips/${tripId}/expenses/${expenseId}/revisions`, {
      headers: { [TRIP_TOKEN_HEADER]: token },
    });
    return revisionsResponseSchema.parse(response).revisions;
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
  device ??= createDevice(new DeviceDb(), transport, deviceId());
  return device;
}
