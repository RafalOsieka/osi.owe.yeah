# Research: how do we add OAuth sign-in to an offline-first Nuxt PWA?

Resolves research ticket #306 ("How do we add OAuth sign-in to an offline-first Nuxt PWA?"), part of map #305 (Accounts). It compares libraries, providers, session designs, test set-ups and deployment settings, and ends with a recommendation. The decisions belong to the grilling tickets that follow.

Researched on 2026-11-27 from primary sources: library repositories, READMEs and source, the npm registry, provider docs (Google, Microsoft Learn, Apple developer docs), OpenID Connect Core, RFC 10017, the RFC 6265bis draft, the OWASP cheat sheets, WebKit's blog and bug tracker, and Playwright's docs. Versions, deprecations and provider rules change, so re-check before committing.

## What Owe Yeah needs

- **A Nuxt 4 SPA** (`ssr: false`) whose shell is prerendered (`nitro.prerender.routes: ['/']`) and served by a Nitro server on Node 26, which also answers the API. The same origin serves the page and the API.
- **Offline-first** (ADR 0002): the device keeps whole Trips and an outbox in Dexie and syncs by push/pull; an installed app can stay open for days. The service worker never caches the API.
- **Standing decisions from #305**: no passwords, external identity providers only; signing in needs a connection once per device, and everything after it keeps working offline; the Trip link alone grants nothing; an allowlist gates sign-in until production (on test too); account deletion stays an operator request.
- **Today's credential** is the Trip link: a header (`x-trip-token`, `apps/web/server/utils/trip-access.ts`), not a cookie. That is why CSRF protection is off (`security.csrf: false` in `apps/web/nuxt.config.ts`). Cookie sessions change that.
- **CSP and headers** come from nuxt-security: `connect-src 'self'`, and its defaults `form-action 'self'` and `Cross-Origin-Opener-Policy: same-origin` (`nuxt-security/dist/defaultConfig.mjs`).
- **Tests stand in for third parties** at the HTTP boundary (`apps/web/test/e2e/harness/frankfurter.ts`, `push-service.ts`), pointed at by `NUXT_*` settings. No module mocking.
- **Secrets** follow the VAPID pattern: an empty `runtimeConfig` key in `nuxt.config.ts`, set by a `NUXT_*` variable in `deploy/osieka-dev/compose.yaml`, which the host supplies.

## Libraries

### Status as of 2026-11

| Library                     | Latest (npm)       | What it owns                                                                                     | Status                                                                                           |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `nuxt-auth-utils`           | 0.6.2, 2026-11-06  | Sealed cookie session, OAuth route handlers for 50+ providers, optional WebAuthn                 | Active. v0.6 moved to `nuxt/server` (Nuxt 4.6+) and "runs on Nuxt 4 and Nuxt 5"                  |
| `openid-client`             | 6.9.1, 2026-11-20  | Nothing: a client API (discovery, PKCE, ID token validation)                                     | Active, OpenID Certified (Basic, FAPI 1.0, FAPI 2.0 RP)                                          |
| Better Auth (`better-auth`) | 1.7.28, 2026-11-24 | `user`, `session`, `account`, `verification` tables, its own `/api/auth/*` routes and Vue client | Very active; absorbed Auth.js                                                                    |
| Auth.js (`@auth/core`)      | 0.41.3, 2026-07-20 | Sessions (JWT or adapter tables)                                                                 | "Now part of Better Auth"; security patches and urgent issues only; no official Nuxt integration |
| `arctic`                    | 3.7.0, 2025-05-21  | Nothing: OAuth 2.0 clients per provider                                                          | **Deprecated** in July 2026                                                                      |
| `lucia`                     | 3.2.2              | Sessions                                                                                         | **Deprecated** (now a learning resource)                                                         |

Sources: npm registry metadata for each package; [nuxt-auth-utils README](https://github.com/atinux/nuxt-auth-utils); [openid-client README](https://github.com/panva/openid-client); [Auth.js joins Better Auth](https://better-auth.com/blog/authjs-joins-better-auth) (2025-09-22: "we'll keep addressing security patches and urgent issues", "we strongly recommend new projects to start with Better Auth"); [authjs.dev](https://authjs.dev/) lists Next.js, SvelteKit, Express and Qwik; [Arctic README](https://github.com/pilcrowonpaper/arctic) ("Arctic was deprecated on July 2026"), whose npm versions carry a deprecation notice.

Arctic, Lucia and Auth.js are out. Three real options remain.

### A. `nuxt-auth-utils`

- **Session.** A sealed (encrypted) cookie, `nuxt-auth-session`, via `useSession` from `nuxt/server`, `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/'`. The key is derived from Nuxt's `appSecret` (`NUXT_APP_SECRET`, at least 32 characters; Nuxt 4.6 introduced it as "the only secret you need to configure", [Nuxt 4.6 post](https://nuxt.com/blog/v4-6)). `maxAge` "counts from the last write: each `setUserSession` call extends the cookie". The cookie is capped at 4096 bytes. ([README](https://github.com/atinux/nuxt-auth-utils), Configuration and Migrate from v0.5)
- **No server-side session store.** Clearing a session deletes the cookie; a stolen or old cookie stays valid until `maxAge`. Revocation needs our own check, for example a session id in the sealed data looked up in a table. The `fetch` session hook only runs when the client fetches `/api/_auth/session`, not on every API request.
- **Provider handlers** (`defineOAuth<Provider>EventHandler`, env `NUXT_OAUTH_<PROVIDER>_CLIENT_ID` etc.) vary in depth. From the source (`src/runtime/server/lib/oauth/*.ts`):
  - Google: state cookie, no PKCE, then calls the userinfo endpoint (`oauth2/v3/userinfo`).
  - Microsoft: PKCE and state, needs a `tenant` setting, default scope `User.Read`, and reads the user from Microsoft Graph `/me` rather than the ID token.
  - Apple: `response_mode: 'form_post'`, the state cookie set `sameSite: 'none'` so it survives Apple's cross-site POST, and verifies the ID token.
  - Generic OIDC: PKCE, state and nonce; it parses the ID token without checking its signature. OIDC Core allows that only because the token came straight from the token endpoint over TLS ([OIDC Core 3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)).
- **State, nonce and PKCE live in short-lived cookies** in the browser that started sign-in. That's a problem for the iOS hand-off described under [iOS](#ios-and-installed-apps).
- **Fit.** Works with `ssr: false` and a prerendered shell, because it needs a running server (`nuxt build`), not `nuxt generate`. It depends on `openid-client` and `jose` itself.

### B. `openid-client` plus our own session table

- **What it does.** Discovery, the authorization code flow with PKCE, state and nonce checks, and ID token validation (`authorizationCodeGrant`, which accepts the callback as a `URL` or a `Request`, so Apple's `form_post` works too). It runs on Web APIs ("Assumes runtime support of WebCryptoAPI and Fetch API", Node 20+), so it doesn't care whether Nitro is v2 or v3. Deps: `jose` and `oauth4webapi`, both by the same author. ([README](https://github.com/panva/openid-client), [authorizationCodeGrant](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md))
- **Microsoft multi-tenant issuers are handled.** `/common` discovery returns the issuer `https://login.microsoftonline.com/{tenantid}/v2.0`. `discovery()` with the issuer URL (not the full `.well-known` URL) substitutes the token's `tid` before comparing `iss` ([openid-client#893](https://github.com/panva/openid-client/issues/893), closed 2026-09-09).
- **Tests over plain HTTP.** `allowInsecureRequests(config)` lifts the HTTPS-only rule. It is marked deprecated on purpose, to flag it as a test/dev switch ([docs](https://github.com/panva/openid-client/blob/main/docs/functions/allowInsecureRequests.md)). It maps onto a setting like today's `notificationsAnyEndpoint`.
- **What we write.** A start route and a callback route per provider (or one parameterised route), a pending sign-in record, an `accounts` table keyed by issuer and subject, a `sessions` table, and cookie handling with `setCookie`/`getCookie` from `nuxt/server`. Apple's client secret is a JWT we sign with `jose`.
- **Fit.** We own the schema, so `trip_id` rules, `uuidv7()` defaults, `export.sql`/`erase.sql` coverage and forward-only migrations stay ours. It's the same reasoning as ADR 0002 (own sync over a sync service).

### C. Better Auth

- **Integration.** A catch-all `server/api/auth/[...all].ts` passing `toWebRequest(event)` to `auth.handler`; `createAuthClient` from `better-auth/vue`; server routes call `auth.api.getSession({ headers })` ([Nuxt integration](https://www.better-auth.com/docs/integrations/nuxt)).
- **It owns four tables** (`user`, `session`, `account`, `verification`). Table and column names can be changed, ids can be left to the database (`generateId: false`), and the CLI writes a Drizzle schema (`migrate` works only with its Kysely adapter) ([database](https://www.better-auth.com/docs/concepts/database)). Its rows still follow its model, not the glossary's.
- **Sessions** are database rows whose `token` is the cookie value, 7 days by default, extended when `updateAge` is reached, revocable one by one or all at once. An optional cookie cache can leave a revoked session valid "until the cache expires" ([session management](https://www.better-auth.com/docs/concepts/session-management)).
- **Allowlist hook.** `user.validateUserInfo` can "reject an OAuth identity before Better Auth creates a user, links a new account, or signs a returning user back in"; `disableSignUp`/`disableImplicitSignUp` exist too ([OAuth](https://www.better-auth.com/docs/concepts/oauth)).
- **Microsoft** is keyed on `oid`, not `sub`, and the page warns that the `email` claim is "tenant-mutable and never verified by Microsoft". Upgrading from 1.6 meant migrating account rows from `sub` to `oid` ([Microsoft provider](https://www.better-auth.com/docs/authentication/microsoft)). That's an example of upgrade churn landing in our data.
- **Weight.** `better-auth` pulls in `kysely`, `nanostores`, `better-call`, every adapter package and `@better-auth/telemetry` (npm metadata). It runs its own routes and client library on top of ours, and the iOS hand-off below would mean working around it.

## Providers

### Google

- **Setup.** A Google Cloud project, an OAuth consent screen and a web OAuth client. Discovery: `https://accounts.google.com/.well-known/openid-configuration` ([OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)).
- **Before strangers can sign in.** "Testing" status limits sign-in to 100 listed test users. The exception is apps that request only name, email and profile: their users needn't be on the list, see no warning, and their authorizations don't expire after 7 days ([Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en)). So the test-user list isn't an allowlist we can use. "In production" is open to any Google Account. Basic scopes need no data-access verification. Brand verification (Search Console domain, privacy policy on the same domain, public home page) is needed only to show our name and logo on the consent screen, usually in minutes ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)).
- **Claims.** `sub` is "unique among all Google Accounts and never reused", "never changed", and should be the key. `email` "may not be unique to this account and could change over time". `email_verified` says whether it is verified. `hd` names the Workspace domain and can be trusted ([OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)).
- **Redirect URIs.** HTTPS only, except localhost (including loopback IPs); no wildcards, fragments or raw IPs ([web server flow, redirect URI validation](https://developers.google.com/identity/protocols/oauth2/web-server)). `http://localhost:3000/...` works for development.

### Microsoft (personal and work/school through one registration)

- **One registration covers both.** `signInAudience: AzureADandPersonalMicrosoftAccount` ("Accounts in any organizational directory ... and personal Microsoft accounts") with the `/common` endpoint ([supported account types](https://learn.microsoft.com/en-us/entra/identity-platform/supported-accounts-validation)). With that audience: at most two client secrets, 100 redirect URIs, and no query strings or wildcards in them ([redirect URI rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)).
- **Setup.** Since June 2024 every new app must be registered in a directory (tenant), so a free Entra tenant comes first ([breaking changes](https://learn.microsoft.com/en-us/azure/active-directory/develop/reference-breaking-changes)).
- **Before strangers can sign in.** Nothing is required for basic sign-in. Publisher verification (a verified Microsoft AI Cloud Partner Program account, a custom domain on the tenant, free) adds the blue "verified" badge. Without it, risk-based step-up consent blocks newly registered multi-tenant apps only when they ask for more than "basic sign-in and read user profile" ([publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)). A work tenant whose admin turned off user consent can still block its users. Personal accounts aren't affected.
- **Claims.** `sub` is immutable but pairwise: "unique to an application ID", so a new registration gives every user a new `sub`. `oid` is immutable, the same across apps in a tenant, "can't be reused", and needs the `profile` scope. `tid` is the tenant (`9188040d-6c67-4c5b-b112-36a304b66dad` for personal accounts). Microsoft's advice: "use `sub` or `oid` alone ... with `tid` used for routing" ([ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)). The same person in two tenants is two accounts by design.
- **Email can't be trusted.** `email` "isn't guaranteed to be correct and is mutable over time. Never use it for authorization", and `preferred_username` is mutable too. The optional claim `xms_edov` says whether the email domain's owner is verified (Microsoft accounts, Google accounts and OTP users qualify; it needs the `email` claim present) ([optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference)).
- **Redirect URIs.** HTTPS, except `http://localhost`, where the port is ignored for matching. Microsoft recommends separate registrations for development and production ([redirect URI rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)).

### Apple

- **Cost and setup.** Configuring it takes the Account Holder or Admin role in a paid Apple Developer Program team ([Sign in with Apple help](https://developer.apple.com/help/account/capabilities/about-sign-in-with-apple)). You need a primary App ID with the capability, a Services ID (the web `client_id`) with registered domains and return URLs, and a private key. Apple's environment page says that for web sign-in "you must have an existing app in the App Store that uses Sign in with Apple" ([configuring your environment](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple)). Check that requirement before choosing Apple: Owe Yeah has no native app.
- **Client secret.** An ES256 JWT signed with that key, which expires at most 15777000 seconds (six months) after issue ([creating a client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret)). The server should sign it from the stored key rather than keep a JWT someone has to renew by hand.
- **Flow quirks.** If any scope (`name`, `email`) is requested, `response_mode` must be `form_post`: Apple sends a cross-site POST to the return URL. The return URL "must use the HTTPS protocol, include a domain name, can't be an IP address or localhost" ([authorization request](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server.)). So there's no real Apple sign-in in local development or CI. The name arrives only the first time, in the POST body, not in the token. The email comes in the identity token every time.
- **Claims.** Use the user identifier, which "remains unique and static for your developer team", not the email. The email is either the real address or a private relay address, and "Apple verifies that the email address works" ([receiving the identity token](https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token)). Developers report `email_verified`/`is_private_email` arriving as strings or booleans, sometimes missing ([Apple developer forums](https://developer.apple.com/forums/thread/762519)); parse both. Server-to-server notifications report `email-disabled`, `email-enabled`, `consent-revoked` and `account-deleted` ([account changes](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts)).
- **Worth it?** No primary source says what iPhone users of a PWA expect. Google and Microsoft sign-in work on iPhones too, and Apple adds a paid membership, an App Store question, a 6-monthly secret, a cross-site POST and no local testing. Defer it until real users ask for it.

### Other cheap options

- **GitHub**: free, no review, but plain OAuth (no ID token), and verified emails come from a separate API with the `user:email` scope ([emails API](https://docs.github.com/en/rest/users/emails)). Its users are developers, not a travelling group. Not worth it.
- **Generic OIDC** (for a self-hosted identity provider or a future provider) comes free with option B or A's generic handler. The same code path is what the test stand-in exercises.

### Identifiers at a glance

|           | Stable key                                     | Email                             | Email verified                            | Can the email change or be reused     |
| --------- | ---------------------------------------------- | --------------------------------- | ----------------------------------------- | ------------------------------------- |
| Google    | `iss` + `sub` (global per Google Account)      | `email`                           | `email_verified`                          | Yes, can change; not unique           |
| Microsoft | `tid` + `oid` (or `sub`, per app registration) | `email` (optional claim or scope) | Not by default; `xms_edov` optional claim | Yes, mutable, never for authorization |
| Apple     | `sub` (per developer team)                     | Real or relay address             | Apple says it works; claim type varies    | Relay can be turned off by the user   |

OIDC itself says the same: "The sub (subject) and iss (issuer) Claims from the ID Token, used together, are the only Claims that an RP can rely upon as a stable identifier for the End-User" ([OIDC Core 5.7](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability)). Key `accounts` on (issuer, subject), with Microsoft's subject being `oid` and its issuer the tenant, so a new app registration doesn't orphan every Microsoft account.

### What this means for the allowlist

An allowlist is written before someone's first sign-in, when only their email is known. Two ways to handle that:

1. **Allowlist by email, accepted only when verified, then bound to (issuer, subject) on first sign-in.** Google: `email_verified` true. Microsoft: `xms_edov` true, else not matched. After binding, a later email change doesn't matter. Apple relay addresses won't match a real address.
2. **Allowlist by (issuer, subject) only.** Refused people see a "not on the allowlist" screen showing an id the operator adds by hand. This needs no email trust, but costs a round trip per person.

Either way, keep the allowlist in the database and edit it by hand, like the per-account settings rule in #305.

## Sessions in a PWA that works offline for days

### Cookie or token in IndexedDB

|                                        | HttpOnly cookie, server-side session                                   | Token kept by the app in IndexedDB, sent as a header                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| XSS                                    | Script can't read it; it can only make requests while the page is open | Script can read and exfiltrate it: RFC 10017 lists "steal data from origin-based storage mechanisms (e.g., localStorage, IndexedDB)" |
| CSRF                                   | Needs a defense (below)                                                | None needed, like today's `x-trip-token`                                                                                             |
| Safari tab, 7 days without interaction | Server-set cookies aren't capped                                       | IndexedDB is deleted with all script-writable storage                                                                                |
| Service worker, `fetch`                | Same-origin requests carry it by default                               | The worker or app must read it and add the header                                                                                    |
| Revocation                             | Delete the row                                                         | Same, if the token is an opaque id checked server-side                                                                               |

- [RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.txt) (OAuth 2.0 for Browser-Based Applications, BCP 212, August 2026) "strongly recommends" a backend-for-frontend (BFF) for sensitive apps. That's what Owe Yeah's Nitro server already is: tokens never reach the browser. Its BFF cookies "MUST" be `Secure` and `HttpOnly`, "SHOULD" be `SameSite=Strict`, path `/`, no `Domain`, and use the `__Host-Http-` prefix (6.1.3.2).
- WebKit caps cookies "created through document.cookie" to seven days and advises "set your authentication cookies in an HTTP response and mark them Secure and HttpOnly" ([ITP 2.1](https://webkit.org/blog/8613/intelligent-tracking-prevention-2-1/)). The CNAME-cloaking cap applies only to third-party hosts; a first-party host with no cloaking has "No cap" ([CNAME cloaking](https://webkit.org/blog/11338/cname-cloaking-and-bounce-tracking-defense/)). Our page and API share one origin.
- The 7-day rule deletes "all of a website's script-writable storage after seven days of Safari use without user interaction", IndexedDB and service worker registrations included. Home screen web apps "have their own counter of days of use" that real use resets ([full third-party cookie blocking](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). A token in IndexedDB would vanish with the Trips in a Safari tab left alone for a week, while a cookie survives.

The access token from the provider is used once, at the callback, to finish the exchange, then dropped. We don't need refresh tokens: we never call provider APIs after sign-in.

### Lifetime, renewal and revocation

- **Session row**: random id (store only its hash, as the Trip token is today), account, created, last seen, expiry, device label. The cookie carries the id.
- **Sliding expiry.** Extend the session on use, but rewrite the cookie and row at most about once a day so every sync isn't a write. RFC 6265bis says the cookie lifetime limit "SHOULD NOT be greater than 400 days" and recommends 400 days as the default ([draft 22](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis)). An idle limit (for example 90 to 180 days since last seen) plus an absolute cap is a product choice.
- **Revocation**: delete rows (sign out this device, sign out everywhere, operator erasure). Nothing is cached in the cookie, so the next request fails.
- **An app open for days** keeps working offline, because nothing local depends on the session. The cookie is read only when it syncs, and the expiry counts from the last sync, not from when the app opened. A phone that syncs once a month never expires.

### When the session ends while changes are queued

- The server answers 401 for a missing or expired session. Today's client already tells a 401 from a failure (`pull` returns `'invalidLink'` in `apps/web/app/composables/useDevice.ts`); a "signed out" state slots in next to it.
- The outbox stays in Dexie. Sync stops, the app asks the person to sign in again (online), and the outbox is sent after. Every change has its own id and retries are idempotent (ADR 0002), so resending is safe.
- If a **different account** signs in on that device, the queued changes were made by someone else. Tying local Trips and the outbox to the account id that made them (and clearing or holding them on a switch) is a decision for the joining/sync ticket.
- Push subscriptions are keyed `(tripId, deviceId)` today and outlive a session. Signing out should remove them.

### CSRF once there is a cookie

- **SameSite.** With `Lax`, cookies go with cross-site requests only on top-level navigations with a safe method (GET). `Strict` never sends them cross-site ([RFC 6265bis 5.6.7](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis)). A SPA that loads a static shell and then fetches same-origin can use `Strict` for the session cookie: the cross-site navigation fetches only the public shell, and the API calls that follow are same-site. The OAuth callback still works, because the callback route only sets the session cookie (setting is allowed) and reads the state cookie, which must be `Lax`, or `None` for Apple's POST.
- **But SameSite alone isn't enough.** OWASP: SameSite "is useful as a defense-in-depth control but it does not replace a proper CSRF defense". It names `Sec-Fetch-Site` "the primary signal", with an `Origin` check as the mandatory fallback, and custom request headers as a valid defense for APIs ([CSRF cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)). RFC 10017 6.1.3.3.2 adds that the BFF "SHOULD require that the browser-based application includes a custom request header", because "cross-origin requests with a custom request header always require a preflight".
- **For Owe Yeah**: the sync API already sends a custom header on every call (`x-sync-schema`, `apps/web/app/utils/sync-api.ts`). A server middleware that rejects state-changing `/api` requests unless `Sec-Fetch-Site` is `same-origin` (falling back to `Origin` matching our origin) and the header is present covers it, with no token plumbing. nuxt-security's `csrf` option (a token scheme) can stay off; update the comment that explains why.
- **Login CSRF** (an attacker signs the victim in to the attacker's account) is what `state` and PKCE bound to the starting browser prevent. Keep that binding even in the iOS hand-off.

### iOS and installed apps

- **The installed app has its own cookie jar and storage, separate from Safari.** A WebKit engineer on [bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849) (2022): "The current behavior (on Apple platforms) is by design. Home Screen apps are created as isolated entities without shared state with the browser." Signing in in Safari doesn't sign in the installed app, and the reverse holds too.
- **The redirect may leave the installed app.** When sign-in navigates to the provider's origin (outside the app's scope), iOS can show it in an in-app browser view, which keeps the app's jar, or offer to continue in Safari, which doesn't. No Apple or WebKit document specifies which, or when. A recent report against a self-hosted webmail (October 2026) describes the second: the provider page "does not open inside the web app. iOS offers to continue in Safari", the callback runs in Safari, and the state cookie set in the PWA is missing ([bulwarkmail/webmail#1267](https://github.com/bulwarkmail/webmail/issues/1267), a user report, not a primary source). If that happens, any cookie-bound flow (A's handlers, C's routes, a plain B) fails in the installed app.
- **Session cookies have been reset at random in Home Screen apps** on iOS 17.2 to 17.5.1 and later reports (18.1). WebKit could reproduce it, the bug is still open, and the root cause is unknown ([bug 272325](https://bugs.webkit.org/show_bug.cgi?id=272325)). Those were cookies without `Max-Age`/`Expires`, so give our cookie an explicit `Max-Age`. Still, treat a lost session as a normal path (sign in again; the outbox waits), not an error.
- **Storage.** Home Screen web apps get the same quota as Safari, and WebKit grants persistent storage "based on heuristics like whether the website is opened as a Home Screen Web App" ([storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)). The app already asks for it.
- **A hand-off that survives leaving the app.** If the prototype shows the redirect lands in Safari, keep the sign-in attempt on the server, not in a cookie:
  1. The app calls `POST /api/auth/start`. The server stores a pending sign-in (state, nonce, PKCE verifier, expiry, and the hash of a secret it returns to the app) and answers with the provider URL.
  2. The app navigates there. The callback, wherever it runs, looks the pending sign-in up by `state`, finishes the exchange and marks it complete.
  3. If the callback runs in the app's own jar (Android, desktop, iOS in-app view), it sets the session cookie and goes back into the app. If not, it shows "Go back to Owe Yeah", and the app, on `visibilitychange`, redeems the pending sign-in with its secret: `POST /api/auth/redeem` sets the session cookie in the app's own jar.
  - **Risk:** redeeming by a secret the starting app holds is the device-flow pattern, and the starting app could be an attacker who sent the victim the provider link. Mitigations to weigh: short expiry, one redemption, the completion page in Safari naming the account and asking to confirm, and redeeming only from the same IP. This needs a threat-model pass in the sign-in ticket.
  - Option B fits this best: the pending sign-in is just one more table, and `openid-client` doesn't care where state comes from. With A or C the callback routes would be ours anyway.
- **Popups and Google's own button.** Google Identity Services' One Tap uses "a different UX" on ITP browsers, which opens "a pop-up window" ([GIS features](https://developers.google.com/identity/gsi/web/guides/features)). It would also need Google's script under our `script-src`, and our `Cross-Origin-Opener-Policy: same-origin` separates popups from their opener. Stick to a full-page redirect, started by a GET navigation (not a form POST, so `form-action 'self'` never comes into play).

## Testing

### A stand-in OpenID provider in `test/e2e/harness`

Like `frankfurter.ts`, a small `node:http` server that answers what `openid-client` calls:

- `GET /.well-known/openid-configuration`: issuer `http://127.0.0.1:<port>`, the endpoints below, `code_challenge_methods_supported: ['S256']`.
- `GET /jwks`: the public half of a key pair made at start-up with `jose` (`generateKeyPair`, `exportJWK`).
- `GET /authorize`: no login page. It redirects straight to `redirect_uri` with a code and the `state`, for the identity the test queued (`provider.signInAs({ sub, email, email_verified })`), and remembers `nonce` and `code_challenge` for that code.
- `POST /token`: checks the code, the PKCE verifier and the client credentials, then returns an ID token signed with `jose` (`iss`, `aud`, `sub`, `email`, `email_verified`, `nonce`, `iat`, `exp`).
- Every request is kept, so a test can check what the server sent, and a `hold`/error switch covers a slow or failing provider, as the Frankfurter stand-in does.

The server under test points each provider's issuer at it through settings (for example `NUXT_AUTH_GOOGLE_ISSUER`) and turns on `allowInsecureRequests` through a test-only flag, like `NUXT_NOTIFICATIONS_ANY_ENDPOINT`. Because `openid-client` really validates the token, a wrong `aud`, a stale `nonce` or a Microsoft-style `{tenantid}` issuer can be tested for real.

Off-the-shelf alternatives, if the hand-written one grows:

- [`oauth2-mock-server`](https://github.com/axa-group/oauth2-mock-server) (npm, MIT, 9.3.0, 2026-10-14). Discovery, JWKS, `/authorize` that "automatically redirects to the callback endpoint", `/token` with an ID token (default `sub: 'johndoe'`), and `BeforeTokenSigning` events to set claims per test. "Not safe for production use."
- [`navikt/mock-oauth2-server`](https://github.com/navikt/mock-oauth2-server) (JVM, Docker image `ghcr.io/navikt/mock-oauth2-server`, MIT). One issuer per first path segment, and an interactive login page where you type any user and claims, which suits local development better than tests.

### Per suite

- **`db`** (server modules on real PostgreSQL): test the account, allowlist and session modules directly: sign-in result in, account and session rows out, expiry and revocation. No provider is involved, and nothing is mocked, because these modules take the verified claims as input.
- **`e2e-api`** (the built app over HTTP): the whole flow against the stand-in. Call the start route, follow the redirect to the stand-in's `/authorize`, follow its redirect to our callback with the cookie jar, then call the API with the session cookie. Also: allowlist refusal, expired session (401), tampered state, wrong nonce, CSRF rejections (missing `Sec-Fetch-Site`/header, foreign `Origin`).
- **`ui`** (Playwright): a setup project signs in once through the stand-in and saves `storageState`, which tests then reuse. It saves cookies and local storage; pass `indexedDB: true` to include IndexedDB. When tests change server-side state, use one account per parallel worker (`testInfo.parallelIndex`) ([Playwright auth](https://playwright.dev/docs/auth)). The ui suite serves plain `http://localhost`, where browsers accept `Secure` cookies only on localhost, so the session cookie needs a `secure: false` switch for that suite. nuxt-auth-utils documents the same trap ("fails with `state mismatch`"). The `__Host-` prefix requires `Secure`, so it needs the same switch.
- **WebKit.** The `@webkit` journeys run WebKit as an iPhone, but not as an installed Home Screen app, so the iOS hand-off can only be checked on a real device.

### Local development sign-in

- Real Google and Microsoft accept `http://localhost` redirect URIs, so a developer can register their own dev clients. That's a lot of setup for every clone, though.
- Simpler: run a stand-in in development too. Either the harness stand-in started by a dev script, or `navikt/mock-oauth2-server` added to `compose.dev.yml` with its interactive login page, as a generic OIDC provider named "Dev". It's enabled only when its settings are present, so production never shows it.

## Deployment

What the runtime needs, following the VAPID pattern (empty `runtimeConfig` keys, `NUXT_*` from the host):

| Setting                         | Example `NUXT_*`                                                     | Notes                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Public origin for redirect URIs | `NUXT_AUTH_ORIGIN`                                                   | Set it explicitly rather than deriving it from request headers behind the proxy: redirect URIs must match exactly                            |
| Google client id and secret     | `NUXT_AUTH_GOOGLE_CLIENT_ID`, `NUXT_AUTH_GOOGLE_CLIENT_SECRET`       | One OAuth client per environment                                                                                                             |
| Microsoft client id and secret  | `NUXT_AUTH_MICROSOFT_CLIENT_ID`, `NUXT_AUTH_MICROSOFT_CLIENT_SECRET` | Separate registrations for dev and production, as Microsoft advises; secrets have an expiry set at creation, so rotation goes in the runbook |
| Apple (if ever)                 | team id, key id, Services ID, private key (`.p8`)                    | The server signs the client secret JWT (at most six months) from the key                                                                     |
| Issuer overrides                | `NUXT_AUTH_GOOGLE_ISSUER`, ...                                       | Default to the real issuers; tests and dev point them at a stand-in                                                                          |
| Insecure issuer switch          | `NUXT_AUTH_ALLOW_INSECURE_ISSUER`                                    | Tests and dev only, like `NUXT_NOTIFICATIONS_ANY_ENDPOINT`                                                                                   |
| Session cookie `Secure` switch  | `NUXT_AUTH_COOKIE_SECURE`                                            | `false` only for the plain-HTTP ui suite                                                                                                     |
| Session secret                  | `NUXT_APP_SECRET`                                                    | Only with option A (sealed cookie). Option B stores hashed random ids and needs none                                                         |

- **Redirect URIs per environment**: `https://<instance>/api/auth/callback/<provider>` on the self-hosted Docker host, `http://localhost:3000/api/auth/callback/<provider>` in dev. Each must be registered with the provider. Google and Microsoft match exactly (Microsoft ignores the port only on localhost).
- **Compose**: the new variables go on `app` in `deploy/osieka-dev/compose.yaml` as `${...:-}`, so the stack starts without them, and `README.md` lists them. With no provider configured, sign-in can't be offered. Decide whether the app then refuses to start or shows a "sign-in not configured" screen.
- **CSP**: the callback is a top-level navigation, so `connect-src 'self'` is unchanged. The token exchange is server-to-server.

## Recommendation

**Option B: `openid-client` for the protocol, our own `accounts` and `sessions` tables in Drizzle, an HttpOnly server-side session cookie, Google and Microsoft first.**

- `openid-client` is the certified, framework-free part (discovery, PKCE, nonce, ID token validation, Entra's `{tenantid}` issuer). It is the only option untouched by the Nitro v3 move and by any auth framework's lifecycle (Lucia, Auth.js and Arctic all wound down between 2025 and 2026).
- The parts a framework would own (accounts, sessions, allowlist, the pending sign-in for the iOS hand-off) are a few small tables that must follow this repo's rules anyway: `trip_id`-free account tables still need `export.sql`/`erase.sql` coverage, `uuidv7()` defaults and forward-only migrations. A server-side session gives sliding renewal and revocation without a sealed-cookie workaround.
- HttpOnly cookie over an IndexedDB token: RFC 10017's BFF guidance, no XSS exfiltration, and no deletion by Safari's 7-day storage rule. The price is a CSRF defense: `Sec-Fetch-Site`/`Origin` plus the custom header the sync API already sends.
- Key accounts on (issuer, subject), with Microsoft keyed on `tid` + `oid`. Treat email as display data and, at most, a verified-only allowlist match.
- Google and Microsoft (one `/common` registration) cover the group with no review. Apple waits: it's paid, possibly needs an App Store app, rotates every six months, posts cross-site and can't be tested locally.
- **Before building, prototype sign-in in an installed app on a real iPhone.** If the provider page stays in the app's in-app view, the plain redirect flow works. If it moves to Safari, build the server-side hand-off, and design its confirmation step against the device-flow phishing risk.

If writing the routes is too much, option A (`nuxt-auth-utils`) is the smaller step. Its handlers are thin and Nuxt 5-ready, but revocation and the hand-off would still be ours, and its Google/Microsoft handlers read userinfo/Graph rather than a validated ID token. Better Auth only makes sense if we later want its account management and plugins. We'd pay for that with four tables in its shape and upgrade churn that reaches our data.

## Open questions for later tickets

- **iOS installed app**: does the provider page stay in the in-app view or move to Safari, on the iOS versions people use? Prototype on a device. It decides whether the hand-off is needed.
- **Hand-off threat model**: if it's needed, what confirms the person signing in is the person holding the app (confirmation page, one-time code, same IP, short expiry)?
- **Allowlist form**: verified email bound to (issuer, subject) at first sign-in, or subject-only with a "send this id to the operator" screen?
- **Session lifetimes**: idle limit, absolute cap (at most 400 days), and how often a renewal rewrites the cookie.
- **Account switch on a device**: what happens to local Trips and queued changes made by the previous account?
- **Same person, two providers**: one account with several identities (linking), or separate accounts? Linking by email is unsafe with Microsoft's unverified email.
- **Apple**: is an App Store app really required for web-only Sign in with Apple, and do the group's iPhone users ask for it?
- **No provider configured**: refuse to start, or show sign-in as unavailable?
- **CSRF middleware scope**: all `/api` methods except GET/HEAD, and which routes (the OAuth callback, Apple's POST) are exempt.
