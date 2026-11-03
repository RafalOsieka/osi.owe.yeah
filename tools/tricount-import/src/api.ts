import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Tricount's unofficial API, as its Android app talks to it (see the research on
 * `research/tricount-export`). Only read: an anonymous device session is registered, then
 * the Tricount is read with GET. The share token is kept in memory only: it never appears in
 * a message, a log or a saved file, as it gives write access to the Tricount and can't be
 * revoked.
 */
const API = 'https://api.tricount.bunq.com';
const HEADERS = {
  'User-Agent': 'com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C',
  // A constant the app sends.
  'X-Bunq-Client-Request-Id': '049bfcdf-6ae4-4cee-af7b-45da31ea85d0',
};

/** The share token of a link (`https://tricount.com/<token>`), or a token on its own. */
export function shareToken(link: string): string {
  const token = link.trim().split(/[/?#]/).filter(Boolean).at(-1) ?? '';
  if (!/^[\w-]+$/.test(token)) throw new Error('That is not a Tricount share link');
  return token;
}

const sessionSchema = z.object({
  Response: z.array(
    z.object({
      Token: z.object({ token: z.string() }).optional(),
      UserPerson: z.object({ id: z.number().int() }).optional(),
    }),
  ),
});

/**
 * Reads a Tricount by its share link and returns the registry response exactly as the API
 * sent it, for `parseTricount` and for saving.
 */
export async function fetchTricount(link: string): Promise<string> {
  const token = shareToken(link);
  const appId = randomUUID();
  // The API wants a fresh 2048-bit key per installation; nothing is ever signed with it.
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const session = sessionSchema.parse(
    JSON.parse(
      await call('registering a device session', `${API}/v1/session-registry-installation`, {
        method: 'POST',
        headers: { ...HEADERS, 'app-id': appId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_installation_uuid: appId,
          client_public_key: publicKey,
          device_description: 'Android',
        }),
      }),
    ),
  ).Response;
  const auth = session.find((item) => item.Token)?.Token?.token;
  const userId = session.find((item) => item.UserPerson)?.UserPerson?.id;
  if (!auth || userId === undefined) throw new Error('Tricount gave no device session');

  const query = new URLSearchParams({ public_identifier_token: token });
  return call('reading the Tricount', `${API}/v1/user/${userId}/registry?${query}`, {
    headers: { ...HEADERS, 'app-id': appId, 'X-Bunq-Client-Authentication': auth },
  });
}

/** One request's body; failures name the step, never the URL, which holds the token. */
async function call(step: string, url: string, init: RequestInit): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // Network errors name the host, not the URL; the token-holding URL is always well-formed.
    throw new Error(`Tricount could not be reached while ${step}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Tricount answered ${response.status} while ${step}`);
  return response.text();
}
