# Research: does sync treat Cloudflare error pages as offline

Resolves research ticket #95, a child of the map #88 ("Deploying Owe Yeah to a test environment"). It answers how the device's server calls behave when Cloudflare, not the app, answers: the origin or tunnel is down (502, 520-523, 530 with error 1016/1033), or the origin hangs until the edge gives up (524).

Researched on 2026-11-03 from the app code at `fe1fdf5`, the installed `ofetch` 1.5.1 (which Nuxt's `$fetch` is) and `nuxt-security` 2.7.0, and Cloudflare's docs. The `ofetch` behaviour was confirmed with a throwaway script that fed it fake HTML and JSON error responses (not committed). Line numbers are at `fe1fdf5`.

## Answer

Every sync path treats a Cloudflare error as "server unreachable, retry later", the same as no signal. Nothing parses an HTML body as JSON before the status is checked, and nothing writes to the device store before the answer passed its zod schema. The outbox is kept and the next sync sends it again.

The one wrong path is **Reminders**: `remind` reads 403, 409 and 429 as the server's own refusals, whoever sent them. A Cloudflare WAF block (403) or rate limit (429), or `nuxt-security`'s rate limiter (429), is then shown as "can't remind" or "reminded today" instead of falling back to sharing a message. Nothing is stored wrongly, but the creditor is told something false and no Reminder goes out.

| Path | Verdict |
|---|---|
| Push (outbox) | OK |
| Pull (sync and joining by Trip link) | OK |
| Exchange rates | OK (they come with the pull, the device never looks one up) |
| Push subscriptions (subscribe / unsubscribe / forgotten Trips) | OK |
| VAPID key fetch | OK |
| Revisions (History) | OK |
| Reminder status | OK |
| Sending a Reminder | **Wrong**: any 403/409/429 is read as the server's refusal |
| Edge timeout (524) | OK, but slow: an answer waits up to 125 s |

## What Cloudflare sends

- **Origin or tunnel trouble is a 5xx.** With the tunnel connected but the app not answering, `cloudflared` answers `502 Bad Gateway` ("Unable to reach the origin service") ([Tunnel common errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)). With no healthy `cloudflared` connected, it is error 1033 ([error 1033](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/)), which comes as HTTP 530 with the 1xxx code in the body ([error 530](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-530/)). 520-526 are the other Cloudflare-made origin errors ([5xx errors](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/)).
- **An edge timeout is a 524** after the origin gives no answer within 125 s by default; only Enterprise can raise it ([error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)). The origin may still have done the work.
- **The body is HTML by default, JSON when asked.** "By default, error responses are HTML." With `Accept: application/json` (or `application/problem+json`), Cloudflare answers all 1xxx errors and its own 500, 502, 504 and 520-526 as RFC 9457 JSON (`content-type: application/json`), keeping the HTTP status; `*/*` or no `Accept` gets HTML ([Error responses](https://developers.cloudflare.com/fundamentals/reference/error-responses/), [1xxx changelog](https://developers.cloudflare.com/changelog/post/2026-03-11-json-rfc9457-responses-for-1xxx-errors/), [5xx changelog](https://developers.cloudflare.com/changelog/post/2026-04-27-structured-responses-for-5xx-errors/)). Origin-made 5xx pass through unchanged. Retryable codes carry a `Retry-After` header.
- **4xx can come from Cloudflare too.** A WAF block or a rate-limiting rule is a 1xxx error (e.g. 1015 for rate limiting) with a 4xx status ([Error responses](https://developers.cloudflare.com/fundamentals/reference/error-responses/)).

The app gets both bodies: `ofetch` sets `accept: application/json` on a request with a JSON body (`POST`/`PUT`: push, subscribe, remind), and sends no `Accept` of its own on `GET`/`DELETE` (pull, revisions, reminder status, VAPID key, unsubscribe), so those get HTML.

## How `$fetch` handles such an answer

All API calls go through `syncApi`, a `$fetch.create` that adds the sync schema header and notes a 426 (`apps/web/app/utils/sync-api.ts:8-13`). In `ofetch` 1.5.1 (`node_modules/.pnpm/ofetch@1.5.1/node_modules/ofetch/dist/shared/ofetch.CWycOUEr.mjs`):

- **The body is parsed by content type, never forced to JSON.** `text/html` is read as text (lines 82-97, 296-313). JSON is parsed with `destr`, which returns a non-JSON string as is instead of throwing (line 301). So an HTML body can't throw a JSON parse error.
- **Any 4xx/5xx then rejects with a `FetchError`**, unless the call passes `ignoreResponseError` (lines 320-328).
- **A `GET` is retried once at once on 500/502/503/504** (not on 52x or 530); a `POST`/`PUT` is not (lines 145-196). Harmless here: sync runs again within 30 s anyway.
- **There is no client timeout** unless the call sets `timeout` (lines 260-272); `syncApi` sets none.

Confirmed by script: `GET` 502 HTML rejects after 2 calls; 530 and 524 HTML reject after 1; `POST` 502 with Cloudflare's JSON body rejects; a 200 with an HTML body resolves to the HTML string; with `ignoreResponseError`, a 530 or 429 resolves to the response with the HTML as `_data`.

## Path by path

### Push (outbox) — OK

`transport.push` awaits `syncApi(...)` and only then `pushResponseSchema.parse`s the answer (`apps/web/app/composables/useDevice.ts:13-20`). A Cloudflare 5xx (HTML or JSON) rejects before the parse; a 2xx that isn't the app's JSON (e.g. an HTML page) fails the parse. Either way `pushRound` rejects before its store transaction (`apps/web/app/sync/device.ts:584-605`), so the outbox is untouched. `sync` swallows the rejection, "whatever doesn't get through waits for the next sync" (`device.ts:460-478`), and the plugin syncs again on focus, reconnect and every 30 s while visible (`apps/web/app/plugins/sync.client.ts:19-23`).

A 524 after the server applied the push is safe: a resent change is found by its id and answered as the first time (`apps/web/server/api/trips/[id]/push.post.ts:42-43, 71-100`; covered by the unit test "resends a change whose answer was lost under the same id", `apps/web/test/unit/device.spec.ts:208`).

### Pull — OK

`transport.pull` uses `ignoreResponseError`, then returns `invalidLink` on 401, throws on any other non-OK status, and only parses an OK answer (`useDevice.ts:21-30`). In `syncOnce` a throw comes before any store write (`device.ts:494-505`). Cloudflare never sends 401 in this setup (no Cloudflare Access, per #94), so a Cloudflare error can't make a Trip look like a bad link.

Joining by Trip link catches any pull failure as `unreachable` (`device.ts:185-191`), which the Trip page shows as "couldn't be tried", not "invalid link" (`apps/web/app/pages/trips/[id].vue:22-25, 37-38`).

### Exchange rates — OK

The device never looks up a rate: rates come with the pull and are merged into the cache only after a successful pull (`device.ts:497`, `cachedRates` at `device.ts:664-673`). A failed pull keeps the cached rates for Provisional rates. The server's own lookups go outbound from the host, not through Cloudflare's front door.

### Push subscriptions — OK

`syncSubscription` runs after the pull, and records what the server has only after `subscribe`/`unsubscribe` resolved (`device.ts:516-535`). `subscribe` rejects on any error status (`useDevice.ts:37-43`); `unsubscribe` throws on any non-OK status but 401 (`useDevice.ts:44-53`). A forgotten Trip's record is deleted only after its unsubscribe went through, and `syncForgotten` swallows failures (`device.ts:537-550`).

### VAPID key — OK

`browserSubscription` fetches and parses the key before touching the browser's subscription (`apps/web/app/composables/usePushNotifications.ts:51-55`), so an error never drops a working subscription. Turning notifications on reports `failed` on any throw (`usePushNotifications.ts:82-94`); renewing on app open is best effort, tried again on the next open (`apps/web/app/plugins/notifications.client.ts:18-25`).

### Revisions and Reminder status — OK

Both reject on any error status and parse only a success (`useDevice.ts:31-36, 54-59`). History shows its "needs a connection" state on error (`apps/web/app/pages/trips/[id]/expenses/[expenseId]/history/index.vue:16, 60-63`). Reminders fall back to sharing a message when the status can't be read (`apps/web/app/composables/useReminders.ts:29-35, 49-52`).

### Sending a Reminder — wrong

`transport.remind` uses `ignoreResponseError` and maps statuses by number alone: 403 → `notSuggested`, 409 → `unreachable`, 429 → `remindedToday`, anything else non-OK throws (`useDevice.ts:60-79`). The server does refuse with exactly those (`apps/web/server/utils/reminders.ts:51-52, 67-68, 81`), but so can others:

- a Cloudflare WAF block (403) or rate-limiting rule (429), as HTML or, since `POST` asks for JSON, as Cloudflare's JSON;
- `nuxt-security`'s rate limiter, on in production (`apps/web/nuxt.config.ts:132-135`), answers 429 "Too Many Requests" (`nuxt-security/dist/runtime/server/middleware/rateLimiter.js:43-44`);
- the sync schema middleware answers 409 when the app is newer than the server (`apps/web/server/middleware/sync-schema.ts:14-16`).

Then `useReminders` shows "can't remind" for a 403, and for a 429 marks the pair reminded today, so the button says so and no Reminder was sent (`useReminders.ts:75-90`). A misread 409 falls back to sharing, which is right by luck. Status codes alone can't tell these apart; neither can the content type, since Cloudflare and the rate limiter both answer JSON to a JSON request. Nothing is stored: the wrong state lives until the status is read again.

### Edge timeout (524) — OK, slow

A hung origin is answered with 524 after up to 125 s, and then behaves like any 5xx above. Meanwhile further syncs of that Trip join the one running (`device.ts:464-469`), the pull-to-refresh spinner keeps turning (`apps/web/app/composables/usePullToRefresh.ts:25-33`), and joining by link keeps the Trip page waiting (`pages/trips/[id].vue:22-25`). A down database is not this case: postgres.js gives up connecting after 30 s by default ([`connect_timeout`](https://github.com/porsager/postgres#connection-details); the pool sets no other, `apps/web/server/db/client.ts:40`) and the app answers 500. Only a handler that hangs on its own reaches 524.

### The service worker

The app's service worker never caches or answers `/api/` (`apps/web/app/service-worker/sw.ts:17-19, 29`), so no stale or HTML answer reaches the sync client from there. Pages are served from the precached shell, so the app still opens while Cloudflare shows an error page.

## Smallest fixes

1. **Reminders: read a refusal from the body, not the status.** The server names its refusal in the error body, e.g. `createError({ status: 429, statusText: 'Reminded today', data: { refused: 'remindedToday' } })`, with the reasons as a domain zod schema. The client maps only a body that parses to that schema; any other non-OK answer throws, so `useReminders` falls back to sharing. No sync schema change: the statuses stay. Pin it at two levels:
   - **nuxt** test of the real `transport` (in `useDevice.ts`, today only stood in by `FakeServer`) with stubbed endpoints: a 429 and a 403 with an HTML body and with Cloudflare-style JSON make `remind` reject, and the app's refusal bodies map to their outcomes.
   - **api e2e**: extend "lets only the creditor of a current suggestion remind" (`apps/web/test/e2e/api/trips.spec.ts:875`) to assert each refusal's body, so the server keeps the contract the client relies on.
2. **Optional: a client timeout on `syncApi`** (e.g. `timeout: 20_000`), so a hung origin counts as unreachable in seconds instead of after Cloudflare's 125 s. Note `ofetch` retries a timed-out `GET` once, so a pull may take twice that. A **nuxt** test with a never-answering endpoint pins it. Not needed for correctness.

No fix is needed for push, pull, rates, subscriptions, VAPID key, revisions or Reminder status: they already fail closed and retry.

## Not covered

- What a person sees while sync keeps failing: the sync status in the Trip header shows unsynced changes either way; no copy distinguishes "server down" from "offline". That's a product choice, not a bug.
- Honouring Cloudflare's `Retry-After`: sync retries every 30 s regardless, which is well under any rate a Cloudflare error would care about.
