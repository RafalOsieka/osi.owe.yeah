import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';
import { httpTransport } from '../../app/composables/useDevice';

const tripId = uuidv7();
const request = { from: uuidv7(), to: uuidv7() };

let unregister: (() => void) | undefined;

/** Answers the next Reminder sent to the Trip with `answer`, as whatever is in front of it would. */
function answerReminder(answer: () => Response) {
  unregister = registerEndpoint(`/api/trips/${tripId}/reminders`, {
    method: 'POST',
    handler: answer,
  });
}

/** A JSON answer, as the server or a proxy in front of it gives one. */
function json(body: Record<string, string | number | boolean>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('sending a Reminder over HTTP', () => {
  afterEach(() => unregister?.());

  it('is sent when the server takes it', async () => {
    answerReminder(() => new Response(null, { status: 204 }));

    expect(await httpTransport.remind(tripId, 'the-token', request)).toBe('sent');
  });

  it.each([
    ['notSuggested', 403],
    ['unreachable', 409],
    ['remindedToday', 429],
  ] as const)('is refused as %s when the server names it', async (refused, status) => {
    answerReminder(() => json({ refused }, status));

    expect(await httpTransport.remind(tripId, 'the-token', request)).toBe(refused);
  });

  it.each([
    [
      'an HTML 403',
      () =>
        new Response('<!DOCTYPE html><title>Attention Required! | Cloudflare</title>', {
          status: 403,
          headers: { 'content-type': 'text/html; charset=UTF-8' },
        }),
    ],
    [
      'a Cloudflare-style JSON 403',
      () =>
        json(
          {
            title: 'Error 1020: Access denied',
            status: 403,
            error_code: 1020,
            error_name: 'access_denied',
            cloudflare_error: true,
          },
          403,
        ),
    ],
    [
      'a 429 without a refusal body',
      () =>
        json(
          {
            error: true,
            statusCode: 429,
            statusMessage: 'Too Many Requests',
            message: 'Too Many Requests',
          },
          429,
        ),
    ],
  ])('rejects on %s, which is not the server refusing', async (_, answer) => {
    answerReminder(answer);

    await expect(httpTransport.remind(tripId, 'the-token', request)).rejects.toThrow();
  });
});
