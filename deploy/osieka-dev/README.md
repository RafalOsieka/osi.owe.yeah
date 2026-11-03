# Owe Yeah on osieka.dev

These files are built for one instance: Owe Yeah run by osieka.dev at `owe-yeah-test.osieka.dev`, served through Cloudflare Tunnel from GHCR images, on a Docker host that polls Git. To run your own, copy and adapt them, and replace the `/privacy` and `/terms` pages, which are written for this instance. Why it works this way: [ADR 0005](../../docs/adr/0005-environments-pull-digest-pinned-images-from-git.md).

## How a build reaches test

1. A push to `main` runs CI. Once every job is green, `publish` pushes `ghcr.io/rafalosieka/owe-yeah` (the app) and `ghcr.io/rafalosieka/owe-yeah-migrator`, tagged by commit SHA.
2. It renders `compose.yaml` with both images pinned by digest and commits it to the `deploy` branch as `test/compose.yaml`.
3. The host's stack polls `deploy` every ~5 minutes and redeploys on a change: `db`, then `migrate` to completion, then `app`, with `cloudflared` alongside.
4. `verify-deploy` polls `https://owe-yeah-test.osieka.dev/healthz` until it reports the new commit, or fails the run after ~15 minutes.

## Setting up an environment

1. **Tunnel.** In Cloudflare Zero Trust, create a remotely-managed tunnel for the environment (one per environment, never shared) and copy its token. Add no public hostname yet.
2. **Secrets**, as the stack's environment variables on the host, never in Git or GitHub:
   - `POSTGRES_PASSWORD`: URL-safe (no `@`, `/`, `:`).
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: a pair of the environment's own, from `pnpm --filter @osi/owe-yeah-web exec web-push generate-vapid-keys`. Keep it once in use: a new pair cuts off every subscribed device.
   - `VAPID_SUBJECT`: `mailto:owe-yeah@osieka.dev`.
   - `TUNNEL_TOKEN`: the tunnel's token.
   - `TEST_ENVIRONMENT=true` on test only, which turns on the test banner.
3. **Stack.** Create a stack from this repo, branch `deploy`, file `test/compose.yaml`, polling every ~5 minutes. Redeploying it by hand is the fallback.
4. Check that `cloudflared` reports the tunnel healthy and `app` turns healthy.

## Opening test to the public

Only once the privacy notice and terms are live in the deployed build.

1. **Public hostname** on the tunnel: `owe-yeah-test.osieka.dev` → `http://app:3000`.
2. **Configuration Rule** for that hostname: Rocket Loader, Email Obfuscation and RUM (Web Analytics) injection off. The app's CSP blocks any script Cloudflare injects.
3. **Redirect Rule** for that hostname: HTTP to HTTPS. A service worker can't register over plain HTTP.
4. **Bot Fight Mode** off (zone-wide): it challenges background sync requests, which can't solve a challenge.
5. **Notifications:** turn on tunnel health alerts.
6. **GitHub:** set the repository variable `TEST_URL` to `https://owe-yeah-test.osieka.dev`, which turns on `verify-deploy`.

## Operating test

- **Did the deploy land?** A failed `verify-deploy` job emails, as any failed run does.
- **Is it down?** Cloudflare emails when the tunnel goes unhealthy. An app that crashes behind a healthy tunnel shows at the next deploy check.
- **Logs:** the containers' logs on the host, rotated at 10 MB × 3 per container. Nothing is shipped.
- **Rollback:** fix forward. In an emergency, revert the latest commit on `deploy`; the stack picks it up at its next poll. If the older build breaks on the newer schema, wipe test's database volume and redeploy.
- **Wiping test:** allowed at any time, as the test banner tells its users.
