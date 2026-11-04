# Owe Yeah on osieka.dev

These files are built for one instance: Owe Yeah run by osieka.dev at `owe-yeah-test.osieka.dev`, served through Cloudflare Tunnel from GHCR images, on a Docker host that polls Git. To run your own, copy and adapt them, and replace the `/privacy` and `/terms` pages, which are written for this instance (their text in the i18n catalogs, and the operator in `apps/web/app/utils/operator.ts`), and the source offer in `docker/source-offer.sh` if you publish images. Why it works this way: [ADR 0005](../../docs/adr/0005-environments-pull-digest-pinned-images-from-git.md).

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
3. **Packages.** After the first `publish`, set both GHCR packages to public in their settings, so the host pulls them without a credential. Their images carry the license notices public distribution asks for (`/app/notices`).
4. **Stack.** Create a stack from this repo, branch `deploy`, file `test/compose.yaml`, polling every ~5 minutes. Redeploying it by hand is the fallback.
5. Check that `cloudflared` reports the tunnel healthy and `app` turns healthy.

## Opening test to the public

Only once the privacy notice and terms are live in the deployed build, `owe-yeah@osieka.dev` receives mail, and the GDPR Art. 30 record of processing is written (kept privately, outside this repo, see [Requests](#requests)).

1. **Public hostname** on the tunnel: `owe-yeah-test.osieka.dev` → `http://app:3000`.
2. **Configuration Rule** for that hostname: Rocket Loader, Email Obfuscation and RUM (Web Analytics) injection off. The app's CSP blocks any script Cloudflare injects.
3. **Redirect Rule** for that hostname: HTTP to HTTPS. A service worker can't register over plain HTTP.
4. **Bot Fight Mode** off (zone-wide): it challenges background sync requests, which can't solve a challenge.
5. **Notifications:** turn on tunnel health alerts.
6. **GitHub:** set the repository variable `TEST_URL` to `https://owe-yeah-test.osieka.dev`, which turns on `verify-deploy`.

## What the app relies on Cloudflare for

- **Rate limiting by client.** The limiter keys clients on `CF-Connecting-IP`, which Cloudflare sets to the real client IP, never on `X-Forwarded-For`, which a client can forge. The tunnel must stay the only way in: a request that reaches `app` without the header shares one limit with every other such request.
- **No stale versions at the edge.** The service worker, `/`, `index.html` and the web manifest are sent with `Cache-Control: no-cache`, so Cloudflare revalidates them on every request; the hashed `/_nuxt/` assets they point to are cached for a year. No Cache Rule may override this, or a new version can wait at the edge for hours.

## Operating test

- **Did the deploy land?** A failed `verify-deploy` job emails, as any failed run does.
- **Is it down?** Cloudflare emails when the tunnel goes unhealthy. An app that crashes behind a healthy tunnel shows at the next deploy check.
- **Logs:** the containers' logs on the host, rotated at 10 MB × 3 per container. Nothing is shipped.
- **Rollback:** fix forward. In an emergency, revert the latest commit on `deploy`; the stack picks it up at its next poll. If the older build breaks on the newer schema, wipe test's database volume and redeploy.
- **Wiping test:** allowed at any time, as the test banner tells its users.

## Requests

Requests about personal data and content arrive at `owe-yeah@osieka.dev`, in English or Polish, and a person answers each one. Log each request privately, outside this repo, next to the GDPR Art. 30 record of processing: when it came, what was asked, the Trip id, what was done and when it was answered. Never log or forward a Trip link: whoever holds one can read and change the Trip.

### Finding a Trip

A Trip link is `https://owe-yeah-test.osieka.dev/trips/<id>#<token>`. The id names the Trip, and the token proves the requester holds the link, the only credential there is ([ADR 0001](../../docs/adr/0001-trip-link-is-the-credential.md)). The server keeps only the token's SHA-256, in `trips.token_hash`. The scripts in [`requests/`](requests) take both halves and act only when the token's hash matches. Feed them to `psql` in the stack's `db` container:

```sh
docker exec -i <db container> psql -U postgres -d owe_yeah -v id=<id> -v token=<token> < find.sql
```

`find.sql` shows the Trip and how much is stored with it. If it shows no row, the link names no Trip: it is mistyped or old, or the Trip was erased or is blocked. Tell the requester that no data can be found by that link (Art. 11(2)), within the request's deadline.

### Access and portability (GDPR Art. 15, 20)

**Deadline:** without undue delay, and at the latest one month after the request arrives (Art. 12(3)). It can take two more months when requests are complex or many, if the requester is told so, with the reasons, within the first month. Answering is free (Art. 12(5)).

1. Check the link with `find.sql`.
2. Export it with `export.sql`, run with `-At` so that `psql` prints only the JSON, into `trip.json`. It holds the Trip, its Participants, Expenses, every Revision, the changes (who changed what, by Claim and device id), Reminders and push subscriptions. It leaves out the token's hash, and each subscription's endpoint and keys: those would let the reader push to the browser of whoever subscribed, who may not be the requester (Art. 15(4)).
3. Send the file to the address the request came from. JSON is the machine-readable format portability asks for.

### Erasure (GDPR Art. 17)

**Deadline:** as for access. The app has no Trip delete, so these steps are the only way to erase one.

1. Check the link with `find.sql`.
2. Erase it with `erase.sql`. It deletes the Trip and everything stored with it (Participants, Expenses, Revisions, changes, push subscriptions and Reminders) in one transaction, and says `Erased Trip <id>`. It erases nothing and fails if the link matches no Trip, if rows of the Trip would be left, or if any table with a `trip_id` isn't deleted with the Trip through an `ON DELETE CASCADE` foreign key to `trips`.
3. Tell the requester it's done, and what devices see from then on:
   - Opening the link on a device that doesn't hold the Trip shows "This Trip link doesn't work".
   - A device that holds the Trip keeps its copy and stops syncing, without saying so. It gets no more Notifications, and changes made on it never sync. These copies are on people's devices, out of the operator's reach: the requester should forget the Trip on their devices, and ask the other Participants to do the same.
   - A device whose unsynced changes include the Trip's name or currency (a Trip created offline, or renamed since its last sync) creates the Trip again under the same link on its next sync. The new Trip holds only that device's unsynced changes. Run `find.sql` again a week later, and erase the Trip again if it's back.
4. Outside the database, container logs hold only warnings, which may quote a query's values, and rotate away (10 MB × 3). If a backup of the database exists, the Trip stays in it until the backup expires: say so in the answer, and erase the Trip again after restoring one.

Erasing only part of a Trip, such as one Participant's name or one Expense, has no tested steps yet. Anyone with the link can change or delete it in the app, and the change syncs to every device, but the earlier Revisions keep the old values. If those must go too, build and test the steps first, within the deadline.

### Other rights

- **Rectification** (Art. 16): anyone with the link can correct the Trip in the app; earlier Revisions keep the old values, as above.
- **Restriction** (Art. 18) **or objection** (Art. 21): block the Trip (see below) while the request is decided. If the objection holds, erase the Trip.

### Illegal-content notices (DSA Art. 16, 17)

The terms list what a notice must hold and promise that a person, not an automated tool, decides on it.

1. **Acknowledge** the notice without undue delay (Art. 16(4)), at the notifier's address.
2. **Look:** find the Trip by the link in the notice, and read it with `export.sql`. A notice that holds the elements of Art. 16(2) counts as knowledge of the content (Art. 16(3)). From then on, the hosting exemption only holds if illegal content is acted on expeditiously (Art. 6(1)(b)).
3. **Decide** in a timely, diligent, non-arbitrary and objective manner (Art. 16(6)): is the content illegal, or against the terms' content rules? Act in proportion to it (Art. 14(4)).
4. **Act** on the whole Trip, the only unit there are steps for. Prefer `block.sql`: it makes every link to the Trip stop working, but keeps the data, which an authority may ask for. A block can be lifted after a complaint (the command is in the script). Erase the Trip with `erase.sql` once keeping it no longer serves a purpose.
5. **Tell the notifier** the decision without undue delay, and how to contest it: a complaint to `owe-yeah@osieka.dev`, or the courts (Art. 16(5)).
6. **Write the statement of reasons** (Art. 17). It is due to the affected users at the latest when the Trip is blocked or erased. There is no address for them, so keep it with the log and send it to whoever writes with the Trip link, as the terms say. It states (Art. 17(3)):
   - what was done (blocked or erased), and for how long;
   - the facts it rests on, and that it followed a notice (naming the notifier only if strictly necessary);
   - that no automated means were used;
   - the law that makes the content illegal, or the terms' rule it breaks;
   - the redress: a complaint to `owe-yeah@osieka.dev`, answered within 14 days, or the courts.
7. **Answer complaints** about a decision within 14 days, as the terms promise. If a complaint is right, lift the block.

Also:

- **Threat to life or safety** (Art. 18): information that suggests a criminal offence threatening someone's life or safety goes promptly to the police of the Member State concerned, or to Poland's if it's unclear which, with all the information available.
- **Orders from authorities** (Art. 9, 10): act on them, then tell the authority without undue delay what was done and when.
- **No transparency reports:** providers that are micro or small enterprises are exempt (Art. 15(2)).

### Breaches (GDPR Art. 33, 34)

A breach is personal data lost, changed, disclosed or accessed without authorisation, whether by accident or not. Examples: the database or a dump of it leaks, the host or one of its secrets is compromised, or Cloudflare reports a breach on its side. The 72 hours start when the operator becomes aware of one.

1. **Contain** it: stop what is leaking, and rotate the secrets that may be out. Rotate the VAPID pair only if it leaked, since a new pair cuts off every subscribed device.
2. **Assess** the risk to people: what data, how many Trips and people, and what could follow. A leaked database exposes Trip names, Participants' names, what they spent, device ids and push subscriptions. It exposes no Trip links, only hashes of their 256-bit random tokens.
3. **Notify UODO** without undue delay, and within 72 hours of becoming aware, unless the breach is unlikely to result in a risk to people (Art. 33(1)). A later notification gives the reasons for the delay. Use UODO's online breach form. It states what happened, what data, roughly how many people and records, the likely consequences, what was done, and a contact (Art. 33(3)). What isn't known yet can follow in phases (Art. 33(4)).
4. **Tell the people affected** without undue delay when the risk is high (Art. 34(1)). Say in plain words what happened, the likely consequences, what was done and whom to contact. There is no way to reach them, so this is a public notice where they'll see it, such as in the app (Art. 34(3)(c)).
5. **Record** every breach, notified or not: the facts, its effects, what was done, and, if it wasn't notified, why not (Art. 33(5)). Keep the record with the Art. 30 record.
