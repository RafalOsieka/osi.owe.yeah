import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One push the service got, its payload decrypted as the browser would. */
export type ReceivedPush = { device: string; payload: unknown };

/**
 * A stand-in for the browsers' push services at the HTTP boundary: every endpoint is a path
 * on it, and `subscription` makes one with real keys, as a browser does, so what the server
 * sends can be decrypted (RFC 8291, aes128gcm) and checked. Each endpoint answers 201, or the
 * status `gone` set for it, as a push service answers an endpoint it no longer has.
 */
export async function startPushService() {
  const received: ReceivedPush[] = [];
  const statuses = new Map<string, number>();
  const keys = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const device = (request.url ?? '/').slice(1);
      const key = keys.get(device);
      if (key) {
        const text = decrypt(Buffer.concat(chunks), key.ecdh, key.auth);
        received.push({ device, payload: JSON.parse(text) });
      }
      response.statusCode = statuses.get(device) ?? 201;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // SAFETY: a server listening on a TCP port has an `AddressInfo` address.
  const { port } = server.address() as AddressInfo;

  return {
    received,
    /** A browser's push subscription for `device`, as the device registers it. */
    subscription(device: string) {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      const auth = randomBytes(16);
      keys.set(device, { ecdh, auth });
      return {
        endpoint: `http://127.0.0.1:${port}/${device}`,
        keys: {
          p256dh: ecdh.getPublicKey().toString('base64url'),
          auth: auth.toString('base64url'),
        },
      };
    },
    /** Makes `device`'s endpoint answer `status` from now on, e.g. 410 once it is gone. */
    gone(device: string, status = 410): void {
      statuses.set(device, status);
    },
    /** The payloads `device` got, in the order they came. */
    payloadsOf(device: string): unknown[] {
      return received.filter((push) => push.device === device).map(({ payload }) => payload);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const hmac = (key: Buffer, ...data: (Buffer | string)[]) => {
  const mac = createHmac('sha256', key);
  for (const part of data) mac.update(part);
  return mac.digest();
};

/** Decrypts an aes128gcm Web Push message (RFC 8291) with the browser's keys. */
function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20]!;
  const serverKey = body.subarray(21, 21 + idLength);
  const cipherText = body.subarray(21 + idLength);
  const one = Buffer.from([1]);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey]);
  const ikm = hmac(hmac(auth, ecdh.computeSecret(serverKey)), keyInfo, one);
  const prk = hmac(salt, ikm);
  const key = hmac(prk, 'Content-Encoding: aes128gcm\0', one).subarray(0, 16);
  const nonce = hmac(prk, 'Content-Encoding: nonce\0', one).subarray(0, 12);

  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(cipherText.subarray(-16));
  const padded = Buffer.concat([decipher.update(cipherText.subarray(0, -16)), decipher.final()]);
  // The record ends with a 0x02 delimiter, then zero padding.
  return padded.subarray(0, padded.lastIndexOf(2)).toString();
}
