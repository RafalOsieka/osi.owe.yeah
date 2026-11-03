# Research: putting Cloudflare Tunnel in front of a self-hosted Compose stack

Resolves research ticket #89, a child of the map #88 ("Deploying Owe Yeah to a test environment"). It gathers facts and a recommended shape. The deployment spec (#91) makes the decisions.

Researched on 2026-11-03 from Cloudflare's own docs, the `cloudflared` source and Dockerfile, and the installed `nuxt-security` 2.7.0 and `h3` code (noted inline). Cloudflare moves its docs around a lot: most Tunnel pages now live under `developers.cloudflare.com/tunnel/`, and some still live under `/cloudflare-one/`.

The host is "a self-hosted Docker host, reachable only by outbound connections". Nothing here depends on more than that.

## Recommendation

- **Use a remotely-managed tunnel, one per environment.** Create it in the dashboard (or API/Terraform). Its only secret is the tunnel token. The hostname→service mapping (a "published application") lives in Cloudflare, and the DNS CNAME is created automatically.
- **Run `cloudflared` as a service in the same compose project as the app.** It reaches the app by its compose service name (`http://app:3000`). The `app` service drops its `ports:` entirely, so nothing is published on the host.
- **Point the rate limiter at `CF-Connecting-IP`** (`security.rateLimiter.ipHeader`). Today it keys on the left-most `X-Forwarded-For` entry, which a client can forge, because Cloudflare appends to that header instead of replacing it.
- **Make the origin send `Cache-Control: no-cache` for `/sw.js`** (and for the other unhashed shell files). Otherwise Cloudflare's edge caches `sw.js` for 2 hours by default, which delays every app update by up to that long.
- **Keep Cloudflare's HTML-rewriting and bot features off for the app hostname.** These are Rocket Loader, Email Obfuscation, Web Analytics auto-injection and Bot Fight Mode. They inject scripts that the app's hash-based CSP blocks, and Bot Fight Mode can challenge the sync API.
- **Turn on Always Use HTTPS.** Without it, an `http://` visit reaches the app as plain HTTP, where a service worker can't register.

## 1. Running `cloudflared` as a compose service

### Remotely-managed (token) vs locally-managed

| | Remotely-managed | Locally-managed |
|---|---|---|
| Where the ingress/hostname config lives | In Cloudflare (dashboard, API, Terraform `config_src = "cloudflare"`) | A `config.yml` next to `cloudflared` |
| Secret on the host | One tunnel token (`eyJ…`) | `cert.pem` (account certificate from `cloudflared tunnel login`) plus a `<UUID>.json` credentials file |
| Run command | `cloudflared tunnel run --token …` (or `TUNNEL_TOKEN`) | `cloudflared tunnel run <NAME>` with the config and credentials mounted |
| DNS record | Created automatically when a route is added in the dashboard | `cloudflared tunnel route dns` |

- **Cloudflare's guidance:** "Cloudflare recommends creating remotely-managed tunnels when working with Docker." Locally-managed tunnels in Docker need the `.cloudflared` directory mounted as a volume. ([Update cloudflared](https://developers.cloudflare.com/tunnel/guides/update-cloudflared/))
- **Locally-managed setup:** it needs `cert.pem`, `<UUID>.json` and a hand-written `config.yml`. ([Create a locally-managed tunnel](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/))
- **What the token is:** "Anyone with the token can run the tunnel." You get it from the dashboard (**Add a replica**, copy the install command, and the `eyJ…` part is the token) or from `GET /accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/token`. ([Tunnel tokens](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/))
- **Rotating the token:** **Rotate token** stops the old token for *new* connections, but "existing connectors remain active until restarted". If a token is compromised, also `DELETE …/cfd_tunnel/$TUNNEL_ID/connections`. (same page)
- **For Owe Yeah:** a remotely-managed tunnel keeps the host down to one secret, the same shape as `POSTGRES_PASSWORD` today. The only "config" (hostname → `http://app:3000`) is one line in Cloudflare, which Terraform could hold later if wanted.

### Where the token lives

`cloudflared` reads the token in one of three ways ([Run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/)):

- **`--token <TOKEN>`:** passed on the command line.
- **`TUNNEL_TOKEN`:** an environment variable.
- **`--token-file <PATH>` / `TUNNEL_TOKEN_FILE`:** a file holding the token. This needs `cloudflared` 2025.4.0 or later.

Cloudflare's own packages switched their Linux, macOS and Windows services from `--token` to `--token-file` in 2026.7.2 and 2026.7.3. The release notes file this under vulnerability IDs: a token on the command line is visible in the process list. ([cloudflared RELEASE_NOTES](https://github.com/cloudflare/cloudflared/blob/master/RELEASE_NOTES))

Options for compose, in order of simplicity:

1. **`TUNNEL_TOKEN` from `.env`.** This is the same pattern as `POSTGRES_PASSWORD` in `compose.prod.yaml`, and it keeps the token out of the process arguments. Anyone with Docker access can still see it with `docker inspect`, but they can read `.env` too.
2. **A compose `secrets:` file plus `TUNNEL_TOKEN_FILE=/run/secrets/tunnel_token`.** This keeps the token out of the container environment. Gotcha: the image runs as UID `65532` (below), so the host file must be readable by that UID.

Avoid `command: tunnel run --token ${TUNNEL_TOKEN}`, even though Cloudflare's Docker one-liner and Terraform guide use it. That's exactly the argv exposure Cloudflare moved away from.

### The image

From the official [`Dockerfile`](https://github.com/cloudflare/cloudflared/blob/master/Dockerfile):

- **Base:** distroless (`gcr.io/distroless/base-debian13:nonroot`), so there's no shell and no curl.
- **User:** `USER 65532:65532`.
- **Updates:** `ENV NO_AUTOUPDATE=true`, with the comment "images are updated by pulling a new tag, not by replacing the binary in place".
- **Entrypoint:** `ENTRYPOINT ["cloudflared"]`, `CMD ["version"]`. So the compose `command:` is `tunnel run`.

Image updates and support:

- **Image:** `cloudflare/cloudflared` on Docker Hub. The latest release on 2026-11-03 is `2026.10.7`.
- **Support window:** "Cloudflare supports versions of `cloudflared` that are within one year of the most recent release." ([Downloads](https://developers.cloudflare.com/tunnel/downloads/))
- **Pinning:** pin a release tag (not `latest`), and bump it at least yearly. Dependabot or Renovate on the compose file is the low-effort way.

### Health check

`cloudflared tunnel ready` exists since 2024.11.1 ("Add cloudflared tunnel ready command", [RELEASE_NOTES](https://github.com/cloudflare/cloudflared/blob/master/RELEASE_NOTES)). In the source ([`subcommands.go`](https://github.com/cloudflare/cloudflared/blob/master/cmd/cloudflared/tunnel/subcommands.go)):

- It fails with `--metrics has to be provided` unless the metrics address is set.
- It calls `http://<metrics>/ready`, which answers 200 only when the connector has an active connection to Cloudflare. That's Cloudflare's own liveness probe in its Kubernetes example.

The image is distroless, so the healthcheck has to use the exec form. A fixed metrics address makes the check deterministic. In containers, metrics default to `0.0.0.0` on the first free port in 20241–20245 ([Observability](https://developers.cloudflare.com/tunnel/observability/)).

### Reaching the app: over the compose network, no host port

A published application is "a hostname-to-service mapping" ([Routing](https://developers.cloudflare.com/tunnel/concepts/routing/)). The service URL is whatever `cloudflared` can reach.

Cloudflare's own Terraform guide runs `cloudflared` in a `docker-compose.yml` next to an app container, with ingress `http://httpbin:80`. So the service name over the compose network is the documented pattern, not a workaround ([Terraform guide](https://developers.cloudflare.com/tunnel/guides/terraform/)).

There's no need to go through an existing reverse proxy on the host:

- TLS ends at Cloudflare's edge.
- The edge-to-`cloudflared` leg is encrypted ("outbound-only, post-quantum encrypted connection", [Tunnel overview](https://developers.cloudflare.com/tunnel/)).
- `cloudflared` to `app` is plain HTTP inside the compose network.

`compose.prod.yaml`'s header comment ("HTTPS is terminated by the existing reverse proxy") and its `ports:` mapping don't apply to the tunnel variant.

Origin parameters worth knowing, all with sane defaults ([Origin parameters](https://developers.cloudflare.com/tunnel/reference/origin-parameters/)):

- **`connectTimeout`:** 30s.
- **`keepAliveTimeout`:** 1m30s.
- **`http2Origin`:** `false`. `cloudflared` talks HTTP/1.1 to the app, which is what Nitro serves.

### Recommended compose shape

A sketch, not tested here:

```yaml
services:
  # db and migrate unchanged

  app:
    image: <ghcr image>@<digest>   # per #88: built in CI, promoted by digest
    restart: unless-stopped
    # No `ports:`: only cloudflared reaches it, over the compose network.
    environment: { ... as today ... }
    depends_on:
      migrate:
        condition: service_completed_successfully

  tunnel:
    image: cloudflare/cloudflared:2026.10.7   # pin; Cloudflare supports releases < 1 year old
    restart: unless-stopped
    command: tunnel run
    environment:
      # Remotely-managed tunnel: the token is its only secret. Never on the command line.
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?TUNNEL_TOKEN is required}
      # A fixed metrics address, so `tunnel ready` knows where to look.
      TUNNEL_METRICS: 127.0.0.1:60123
    healthcheck:
      # Distroless image: exec form only. Exits non-zero unless connected to Cloudflare.
      test: ['CMD', 'cloudflared', 'tunnel', '--metrics', '127.0.0.1:60123', 'ready']
      interval: 30s
      timeout: 5s
      retries: 3
    depends_on:
      - app
```

In Cloudflare, add the published application **owe-yeah-test.osieka.dev** with service **`http://app:3000`**. The dashboard creates the proxied CNAME to `<tunnel-UUID>.cfargotunnel.com` itself. If you configure ingress by API or Terraform, end the rules with the `http_status:404` catch-all, as the Terraform guide does.

`depends_on: app` only orders startup. If the app is down, `cloudflared` answers 502 itself.

### Egress the host needs

From [Tunnel with firewall](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/):

- **Required:** outbound **TCP and UDP 7844** to `region1.v2.argotunnel.com` and `region2.v2.argotunnel.com`. QUIC uses UDP, HTTP/2 uses TCP. With the default `--protocol auto`, `cloudflared` falls back to HTTP/2 if UDP is blocked.
- **Optional:** HTTPS 443 to `api.cloudflare.com` and `update.argotunnel.com` (update checks), and `pqtunnels.cloudflareresearch.com` (post-quantum error reports). Blocking these "may cause a log error without stopping `cloudflared`".
- **Pre-checks:** since 2026.5.2, `cloudflared` runs connectivity pre-checks at startup.

A host "reachable only by outbound connections" is exactly the case Tunnel is built for: "No open inbound ports. No public IPs." ([Tunnel overview](https://developers.cloudflare.com/tunnel/))

Availability and redundancy ([Configuration](https://developers.cloudflare.com/tunnel/configuration/)):

- **Connections:** one `cloudflared` opens "four outbound-only … connections to at least two distinct Cloudflare data centers".
- **Replicas:** up to 25 per tunnel. A second replica is the HA option, but it's not needed for test.
- **When the tunnel is down:** visitors get Cloudflare error **1016** ([Routing](https://developers.cloudflare.com/tunnel/concepts/routing/)).
- **Alerts:** "Tunnel Health Alert" notifications exist ([Observability](https://developers.cloudflare.com/tunnel/observability/)). This is relevant to the map's "learning that the app is down" fog.

## 2. Free-plan limits and terms that matter

| Limit | Value | Source |
|---|---|---|
| Tunnel availability | "Available on all plans" | [Tunnel overview](https://developers.cloudflare.com/tunnel/) |
| Tunnels per account | 1,000; ~5,000–10,000 published applications per remotely-managed tunnel | [Routing](https://developers.cloudflare.com/tunnel/concepts/routing/) |
| Request body (Maximum Upload Size) | 100 MB on Free and Pro (413 above it) | [Error 413](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/) |
| Proxy read timeout (origin must start answering) | **125 s**, then 524. Only Enterprise can change it | [Connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) |
| Proxy write timeout | 30 s, then 524 | same |
| Proxy idle timeout | 900 s, then 520 | same |
| Client keep-alive / HTTP/2 idle | 400 s | same |
| Cache Rules | 10 on Free | [Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/) |

What these mean for Owe Yeah:

- **Request size:** the app already caps request bodies far below Cloudflare: `nuxt-security`'s `requestSizeLimiter` defaults to 2 MB (`maxRequestSizeInBytes: 2e6`, `node_modules/nuxt-security/dist/defaultConfig.mjs`).
- **Long requests:** the app has no Server-Sent Events, WebSockets or long-polling (no `EventSource`/`text/event-stream` in `apps/`). Sync is plain request/response, and Web Push goes from the server *out* to the push services, never through the tunnel. The 125 s read timeout only matters for a slow request, such as a pathological sync push. If SSE is ever added, the connection-limits page and the `Response Body Buffering` configuration rule are where to look.
- **Terms:** Cloudflare may "disable or limit" CDN use that serves "video or a disproportionate percentage of pictures, audio files, or other large files" without the paid services meant for them ([Service-Specific Terms, CDN](https://www.cloudflare.com/service-specific-terms-application-services/)). A small HTML+JS+JSON PWA is the ordinary case, and the terms say nothing Tunnel-specific.

## 3. What reaches the app

### Client IP headers

From [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/):

- **`CF-Connecting-IP`:** "provides the client IP address connecting to Cloudflare to the origin web server". It always holds exactly one IP.
- **`X-Forwarded-For`:** if the request had none, it equals `CF-Connecting-IP`. If the client *already sent* one, "Cloudflare will append the IP address of the HTTP proxy connecting to Cloudflare to the header", so the client's own value stays first. Cloudflare recommends reading `CF-Connecting-IP` instead.
- **`X-Forwarded-Proto`:** the visitor's scheme, overwritten if the client set a different value.

### What that means for the rate limiter (`nuxt-security`)

How the installed limiter (2.7.0, `dist/runtime/server/middleware/rateLimiter.js`) picks the client IP:

```js
const ip = customIpHeader ? getRequestHeader(event, customIpHeader) || "" : getRequestIP(event, { xForwardedFor: true }) || "";
```

`h3`'s `getRequestIP(event, { xForwardedFor: true })` takes `x-forwarded-for` split on `,` and keeps the **first** entry (`h3@1.15.11`, `dist/index.mjs`).

Behind Cloudflare, the first entry is whatever the client chose to send. A client can put a random `X-Forwarded-For` on every request and get a fresh bucket each time (150 tokens per 5 minutes per IP and route by default). So the per-IP limiter is trivially bypassed.

The fix is one line of config, `security.rateLimiter.ipHeader: 'cf-connecting-ip'`, in production builds:

- **It's only trustworthy because nothing but `cloudflared` can reach the app.** Keep `app` without `ports:`.
- **Development and e2e need nothing.** The limiter is already off there (`nuxt.config.ts`).
- **The limiter's state** is the default in-memory `lruCache`. It's per container and resets on restart, which is fine for one test instance.

### HTTPS termination and `Secure` cookies

- **Certificate:** TLS ends at Cloudflare. Universal SSL covers the apex and **first-level** subdomains only ([Universal SSL limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)), so `owe-yeah-test.osieka.dev` and `owe-yeah.osieka.dev` are covered (as the map assumed). Something like `x.owe-yeah-test.osieka.dev` would not be.
- **The app sees plain HTTP** from `cloudflared`. That doesn't matter today:
  - The only cookie is the i18n locale cookie. `cookieSecure` is decided at build time (`NODE_ENV === 'production'`), not from the request scheme.
  - The app builds no absolute URLs from the request on the server.
  - The browser sees HTTPS, so `Secure` cookies are kept.
- **If something ever needs the scheme**, it's in `X-Forwarded-Proto`.
- **The SSL/TLS encryption mode** (Flexible/Full/Strict) is about Cloudflare connecting to an origin *address*. A tunnel origin is reached through `cloudflared` instead. Leave the zone setting as it is for the other hostnames.
- **HSTS:** `nuxt-security` already sends `Strict-Transport-Security: max-age=15552000; includeSubDomains` (seen in the built `.output`). Browsers only honour it over HTTPS, hence Always Use HTTPS below.

## 4. What can break the installable PWA, the service worker and Web Push

### Caching of `sw.js` and the app shell

Cloudflare's default caching ([Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/), [Status-code TTLs](https://developers.cloudflare.com/cache/how-to/configure-cache-status-code/)):

- **What gets cached:** by **file extension**, never by MIME type. JS and CSS are cached. HTML and JSON are not, and `webmanifest` isn't in the list. A path without an extension (`/`, `/api/...`) isn't cached.
- **Origin headers win:** if the origin sends `Cache-Control: private`, `no-store`, `no-cache` or `max-age=0`, Cloudflare doesn't cache. Free plans follow origin `Cache-Control` by default.
- **No header at all:** Cloudflare still caches 200s for **120 minutes** (404s for 3 minutes).
- **Browser Cache TTL:** defaults to 4 hours. It applies when the origin sends neither `Cache-Control` nor `Expires` ([Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)).

What Nitro sends today (the built `.output/server`):

- **Hashed assets:** `/_nuxt/` gets `maxAge: 31536000`. That's safe, since they're content-hashed.
- **Everything else:** `/sw.js`, `/index.html`, `/manifest.webmanifest` and the icons get only an `ETag`/`Last-Modified`, with **no `Cache-Control`**.

So **`/sw.js` is cached at Cloudflare's edge for 2 hours** after each deploy:

- Browsers check for a new service worker (hourly here, `periodicSyncForUpdates`). Their default `updateViaCache: 'imports'` skips the *browser* HTTP cache for the main script, but not Cloudflare's edge.
- So for up to 2 hours after a deploy, devices see the old `sw.js`, and the "New version" toast doesn't appear.
- `/` and `/index.html` aren't edge-cached (no extension and HTML respectively). The service worker serves the precached shell for navigations anyway.

Fix at the origin, so it holds whatever sits in front:

- Add a Nitro `routeRules` header of `Cache-Control: no-cache` for `/sw.js`. Ideally also for `/`, `/index.html` and `/manifest.webmanifest`.
- Optionally back it up with a Cloudflare Cache Rule "bypass cache" for `/sw.js`.
- Purging the cache on every deploy works too, but it adds a Cloudflare API token to the deploy job.

### HTML rewriting and injected scripts vs the app's CSP

`nuxt-security` emits a strict CSP for the prerendered shell: `script-src 'self' https: 'unsafe-inline' 'strict-dynamic' 'sha256-…' 'sha384-…'`. With `'strict-dynamic'` and hashes, `'self'`, `https:` and `'unsafe-inline'` are ignored by modern browsers, so **any script Cloudflare injects is blocked**. Cloudflare doesn't modify origin CSP headers (except for Zaraz) ([Cloudflare CSP requirements](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/content-security-policies/)).

| Feature | Default | What it does | Recommendation |
|---|---|---|---|
| **Rocket Loader** | Zone setting; the docs don't state the default, so check it | Rewrites `<script>` tags to defer them; needs `ajax.cloudflare.com` in `script-src` ([Rocket Loader](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/)) | Off (configuration rule per hostname, or zone-wide) |
| **Email Address Obfuscation** | **On at sign-up** | Injects `email-decode.min.js` into HTML that contains email addresses ([Email obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)) | Off for the app hostname (configuration rule) |
| **Web Analytics automatic setup** | "enabled by default" for proxied sites that used Browser Insights | Injects the beacon; needs `static.cloudflareinsights.com` ([Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/)) | Disable, or the `Disable RUM` configuration rule |
| **Bot Fight Mode** | Off until enabled in Security Settings (Free) | Injects JavaScript detections into HTML (can't be turned off while BFM is on, uses `/cdn-cgi/challenge-platform/`); "may challenge API or mobile app traffic"; can't be skipped with WAF rules ([Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/), [JS detections](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/)) | **Keep off.** A challenge on `/api/*` breaks the background sync, which can't solve one |
| Automatic HTTPS Rewrites, Cloudflare Fonts | Zone settings | Rewrite HTML | Not needed (no `http://` links, no Google Fonts); off for the hostname |

- **Per-hostname control:** configuration rules can set `rocket_loader`, `email_obfuscation`, `disable_rum`, `automatic_https_rewrites`, `fonts`, `bic` and others per hostname ([Configuration Rules settings](https://developers.cloudflare.com/rules/configuration-rules/settings/)). That keeps other `osieka.dev` sites unaffected.
- **Zone-wide only:** Bot Fight Mode and Always Use HTTPS aren't configuration-rule settings.
- **A belt-and-braces origin header:** `Cache-Control: no-transform` on HTML makes Cloudflare skip Email Obfuscation, the Web Analytics beacon and JS detections, which the docs state for each of those three. The docs don't say whether Rocket Loader honours it, so turn Rocket Loader off explicitly.

### Always Use HTTPS

- **What it does:** "redirects all your visitor requests from `http` to `https`, for all subdomains and hosts in your application" ([Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)).
- **Why it matters:** without it, `http://owe-yeah-test.osieka.dev` is proxied to the app as HTTP. Service workers, the install prompt and Push need a secure context, and HSTS isn't set over HTTP.
- **Scope:** it's zone-wide. If that's unwanted for other hostnames, use a single redirect rule for the app hostname.
- **Don't redirect at the origin** as well: Cloudflare warns that causes redirect loops.

### Web Push

- **Through the tunnel:** only the API calls that register a subscription and fetch `/api/vapid-key`. These are ordinary JSON requests, uncached because they have no extension.
- **Outside the tunnel:** sending a notification is an outbound request from the app to the push service.
- **What can break it:** only Bot Fight Mode (challenging the API) or a stale `sw.js`, both covered above.

### When the server is unreachable

- **Error codes:** the visitor gets a Cloudflare-generated error page instead of the app's JSON. That's **1016** when no connector is up, or a **502** from `cloudflared` when the app container is down.
- **The installed app** opens anyway: the service worker serves the precached shell for every navigation.
- **Sync** must treat these 5xx/HTML responses as "server unavailable, retry later", not as protocol errors. That's worth a check in the sync client.

## 5. A second environment

- **Capacity isn't the constraint.** "You can publish multiple applications on a single tunnel" ([Routing](https://developers.cloudflare.com/tunnel/concepts/routing/)), and an account gets 1,000 tunnels.
- **The token is.** It "can run the tunnel", meaning every hostname routed through it. One shared tunnel would put prod's routing in the test host's hands, against the map's "secrets separate per environment, never shared".
- **Recommendation: one tunnel per environment**, e.g. `owe-yeah-test` and later `owe-yeah-prod`:
  - each with its own token in its own `.env`;
  - each with one published application, `owe-yeah[-test].osieka.dev` → `http://app:3000`;
  - each `cloudflared` running inside that environment's compose project.
- **Name collisions:** compose project names (`name:`) keep each stack's default network separate, so `app` resolves to the right container even if both stacks share a host.
- **Separate lifecycles:** test's tunnel can be deleted or rotated without touching prod. Health alerts and load balancers also address tunnels by UUID.
- **Replicas** of one tunnel are for HA within one environment, not for separating environments ([Configuration](https://developers.cloudflare.com/tunnel/configuration/)).

## Open points for the spec (#91)

- Set `security.rateLimiter.ipHeader: 'cf-connecting-ip'` for production builds. Decide whether local runs of the prod compose without Cloudflare need an escape hatch (without the header, every request shares the `""` bucket).
- Add a `Cache-Control: no-cache` route rule for `/sw.js` (and the other unhashed shell files), maybe with `no-transform` on HTML.
- Define the zone settings checklist for the app hostname:
  - Rocket Loader off;
  - Email Obfuscation off;
  - RUM disabled;
  - Bot Fight Mode off;
  - Always Use HTTPS on (zone-wide, or a redirect rule).
- Decide where the tunnel's hostname mapping is recorded: a manual dashboard step written down in the runbook, or Terraform.
- Choose the token delivery: `TUNNEL_TOKEN` in `.env` vs `TUNNEL_TOKEN_FILE` with a compose secret readable by UID 65532.
- Decide how the `cloudflared` image tag is kept fresh within the one-year support window.
- Check that the sync client treats Cloudflare/`cloudflared` 5xx and HTML error pages as "offline, retry".
- Decide whether the app gets its own healthcheck. The image has `node`, so `node -e "fetch(...)"` would work. It would let `depends_on: condition: service_healthy` and monitoring see "app down" separately from "tunnel down".
