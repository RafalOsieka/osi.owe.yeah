# Owe Yeah on osieka.dev

These files are built for one instance: Owe Yeah run by osieka.dev at `owe-yeah-test.osieka.dev`, served through Cloudflare Tunnel from GHCR images, on a Docker host that polls Git. To run your own, copy and adapt them, and replace the `/privacy` and `/terms` pages, which are written for this instance (their text in the i18n catalogs, and the operator in `apps/web/app/utils/operator.ts`), and the source offer in `docker/source-offer.sh` if you publish images. Why it works this way: [ADR 0005](../../docs/adr/0005-environments-pull-digest-pinned-images-from-git.md).

## How a build reaches test

1. A push to `main` runs CI. Once every job is green, `publish` pushes `ghcr.io/rafalosieka/owe-yeah` (the app) and `ghcr.io/rafalosieka/owe-yeah-migrator`, tagged by commit SHA. Pull requests run every job but `publish` and `verify-deploy`.
2. It renders [`compose.yaml`](compose.yaml) with both images pinned by digest. `MIGRATOR_IMAGE` and `APP_IMAGE` are the only variables it fills in, and it fails if anything else changed. It commits the result to the `deploy` branch as `test/compose.yaml`, creating the branch if it's missing, one `Deploy <commit> to test` commit per deploy. A newer push to `main` cancels an older run still in progress, so deploys land in order.
3. The host's stack polls `deploy` every ~5 minutes and redeploys on a change: `db`, then `backup` and `migrate` to completion, then `app`, with `cloudflared` alongside. A failed dump or migration keeps `app` down (see [Dumps](#dumps)).
4. `verify-deploy` polls `$TEST_URL/healthz` every 30 seconds until it reports the new commit, or fails the run after ~15 minutes. It's skipped while the repository variable `TEST_URL` is unset (see [Opening test to the public](#opening-test-to-the-public)).

## Setting up an environment

1. **Tunnel.** In Cloudflare Zero Trust, create a remotely-managed tunnel for the environment (one per environment, never shared) and copy its token. Add no public hostname yet.
2. **Secrets**, as the stack's environment variables on the host, never in Git or GitHub:
   - `POSTGRES_PASSWORD`: URL-safe (no `@`, `/`, `:`).
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: a pair of the environment's own, made once on any machine with the repo installed by `pnpm --filter @osi/owe-yeah-web exec web-push generate-vapid-keys`. Keep it once in use: a new pair cuts off every subscribed device until it turns notifications on again. Without the pair the app still runs, but notifications can't be turned on.
   - `VAPID_SUBJECT`: `mailto:owe-yeah@osieka.dev`.
   - `TUNNEL_TOKEN`: the tunnel's token.
   - `TEST_ENVIRONMENT=true` on test only, which turns on the test banner.

   The stack refuses to start without `POSTGRES_PASSWORD` or `TUNNEL_TOKEN`.

3. **Packages**, once, before the first `publish`. The images build in this instance's operator details and aren't distributed, so both GHCR packages stay private. A package CI creates would take the repository's visibility, public from its first push, so create them by hand:
   1. Build both images from `main` and push them, tagged by its commit SHA, to `ghcr.io/rafalosieka/owe-yeah-migrator` and `ghcr.io/rafalosieka/owe-yeah` from your machine, logged in to `ghcr.io` with a classic token with `write:packages`. A package pushed this way starts private.
   2. In each package's settings, untick **Inherit access from repository**, give `osi.owe.yeah` the **Write** role under **Manage Actions access**, and invite the bot account (below) with the **Read** role.

   `publish` refuses to push to a package it can't read or that anyone can pull.

4. **Registry credential.** The host pulls as a bot GitHub account that can read only these two packages. Give the stack a registry credential for `ghcr.io`: the bot's username and a classic token with only `read:packages`, expiring in a year. GitHub emails the bot's address a week before it expires, so that address must reach the operator.
5. **Stack.** Create a stack from this repo, branch `deploy`, file `test/compose.yaml`, polling every ~5 minutes. Redeploying it by hand is the fallback.
6. Check that `cloudflared` and `app` turn healthy: `cloudflared` once the tunnel holds a connection to Cloudflare, `app` once `/healthz` answers.
7. **Off the host.** Copy the stack's `backups` volume off the host regularly: a dump that stays on the host is lost with it. Keep the stack's secrets (above) and the registry credential in a password manager: a restored database is of no use without `POSTGRES_PASSWORD`, and a lost VAPID pair cuts off every subscribed device.

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

- **Did the deploy land?** A failed `verify-deploy` job emails, as any failed run does. If `publish` passed but test still runs the old commit, look at the host's pulls first: once the bot's token expires, they fail as unauthorized. Make it a new token and update the stack's registry credential.
- **Is it down?** Cloudflare emails when the tunnel goes unhealthy. An app that crashes behind a healthy tunnel shows at the next deploy check.
- **Logs:** the containers' logs on the host, rotated at 10 MB × 3 per container. Nothing is shipped.
- **Rollback:** fix forward. In an emergency, revert the latest commit on `deploy`; the stack picks it up at its next poll. If the older build breaks on the newer schema, [restore the dump](#restore-a-dump) made before the deploy that broke it, or wipe test's database volume and redeploy.
- **Wiping test:** allowed at any time, as the test banner tells its users.
- **Pausing test:** [`pause-worker.js`](pause-worker.js) is a Cloudflare Worker that answers every request with a `503` page, in English and Polish, saying test is unavailable for now and giving `owe-yeah@osieka.dev`. Nothing reaches the tunnel while it runs, so it works with the host down too.
  - **Set up once:** in the Cloudflare dashboard, **Workers & Pages → Create → Worker**, start from Hello World, name it `owe-yeah-test-paused` and deploy. Then **Edit code**, replace it with the file's and deploy again. It runs on no route yet, so test is unaffected.
  - **Pause:** on the Worker, **Settings → Domains & Routes → Add → Route**, zone `osieka.dev`, route `owe-yeah-test.osieka.dev/*`. **Resume:** delete that route. Either takes effect within seconds.
  - **While paused:** an installed app still opens from its cache. Its syncs fail, so its changes wait on the device and sync once test is back. `verify-deploy` fails, as `/healthz` answers the page.

## Dumps

Every deploy starts with `backup`, which dumps the database before `migrate` touches it: migrations only go forward (ADR 0005), so a dump is the only way back from a bad one. Each dump is `owe_yeah-<UTC time>.dump`, in `pg_dump`'s custom format, on the stack's `backups` volume. Only the newest 5 are kept: each deploy's dump deletes the oldest beyond that. If the dump fails, `migrate` and `app` don't start, and `app` stays down until a deploy dumps successfully. The `backup` container's log says why.

The `db` container sees the dumps read-only at `/backups`, so these commands all run in it. The dumps hold everything the database does, Trip names and Participants' names included: copy them only to places as private as the host.

### Restore a dump

1. Stop `app`, so nothing writes to the database:

   ```sh
   docker stop <app container>
   ```

2. Pick a dump. Their names sort by time, oldest first:

   ```sh
   docker exec <db container> ls -l /backups
   ```

3. Drop and recreate the database, then restore the dump into it:

   ```sh
   docker exec <db container> psql -U postgres -d postgres -c 'DROP DATABASE owe_yeah WITH (FORCE)' -c 'CREATE DATABASE owe_yeah'
   docker exec <db container> pg_restore -U postgres -d owe_yeah --exit-on-error /backups/<dump>
   ```

4. Start the stack again by redeploying it. That dumps the restored database too, which pushes out the oldest dump, then migrates it to the deployed build's schema. If the deploy that broke the database is still on `deploy`, revert it there first, or `migrate` runs the same migration again.

## Requests

Requests about personal data and content arrive at `owe-yeah@osieka.dev`, in English or Polish, and a person answers each one. Log each request privately, outside this repo, next to the GDPR Art. 30 record of processing: when it came, what was asked, the Trip id, what was done and when it was answered. Never log or forward a Trip link: whoever holds one can read and change the Trip.

### Finding a Trip

A Trip link is `https://owe-yeah-test.osieka.dev/trips/<id>#<token>`. The id names the Trip, and the token proves the requester holds the link, the only credential there is ([ADR 0001](../../docs/adr/0001-trip-link-is-the-credential.md)). The server keeps only the token's SHA-256, in `trips.token_hash`. The scripts in [`requests/`](requests) take both halves and act only when the token's hash matches. Feed them to `psql` in the stack's `db` container:

```sh
docker exec -i <db container> psql -U postgres -d owe_yeah -v id=<id> -v token=<token> < find.sql
```

`find.sql` shows the Trip, whether it is blocked, and how much is stored with it. All the scripts find a blocked Trip by its link. If `find.sql` shows no row, the link names no Trip: it is mistyped or old, or the Trip was erased.

**Refusing:** when a request can't be met, for example because the link names no Trip, tell the requester why within the request's deadline. Say also that they can complain to UODO or go to court (Art. 12(4)). If the operator can't identify them, say so (Art. 11(2)).

### Access and portability (GDPR Art. 15, 20)

**Deadline:** without undue delay, and at the latest one month after the request arrives (Art. 12(3)). It can take two more months when requests are complex or many, if the requester is told so, with the reasons, within the first month. Answering is free (Art. 12(5)).

1. Check the link with `find.sql`.
2. Export it with `export.sql`, run with `-At` so that `psql` prints only the JSON, into `trip.json`. It holds the Trip, its Participants, Expenses, every Revision, the changes (who changed what, by Claim and device id), Reminders and notification subscriptions. It leaves out the token's hash, and each subscription's endpoint and keys: those would let the reader push to the browser of whoever subscribed, who may not be the requester (Art. 15(4)).
3. Send the file to the address the request came from. JSON is the machine-readable format portability asks for.

### Erasure (GDPR Art. 17)

**Deadline:** as for access. The app has no Trip delete, so these steps are the only way to erase one.

1. Check the link with `find.sql`.
2. Erase it with `erase.sql`. It deletes the Trip and everything stored with it (Participants, Expenses, Revisions, changes, notification subscriptions and Reminders) in one transaction, and says `Erased Trip <id>`. It erases nothing and fails if the link matches no Trip, if rows of the Trip would be left, or if any table with a `trip_id` isn't deleted with the Trip through an `ON DELETE CASCADE` foreign key to `trips`.
3. Tell the requester it's done, and what devices see from then on:
   - Opening the link on a device that doesn't hold the Trip shows "This Trip link doesn't work".
   - A device that holds the Trip keeps its copy and stops syncing, without saying so. It gets no more Notifications, and changes made on it never sync. These copies are on people's devices, out of the operator's reach: the requester should forget the Trip on their devices, and ask the other Participants to do the same.
   - A device whose unsynced changes include the Trip's name or currency (a Trip created offline, or renamed since its last sync) creates the Trip again under the same link on its next sync. The new Trip holds only that device's unsynced changes. Run `find.sql` again a week later, and erase the Trip again if it's back.
4. Outside the database, container logs hold only warnings, which may quote a query's values, and rotate away (10 MB × 3). The last 5 [dumps](#dumps) still hold the Trip: it leaves them once 5 more deploys have dumped the database after the erasure, and copies off the host as those copies are replaced. Say so in the answer, and erase the Trip again after restoring a dump.

**Erasing part of a Trip.** The requester can do part of it in the app, and the change syncs to every device:

- A Participant's name: rename the Participant. Names are kept nowhere else.
- An Expense: edit out what must go, or delete it.

Each Expense's earlier Revisions still hold its old values. Erase them with `erase-revisions.sql`, passing `-v expense=<expense id>` from the export. It keeps only the version the Expense is at. A deleted Expense keeps its last state, so edit it before deleting it if that state must go.

### Other rights

- **Rectification** (Art. 16): anyone with the link can correct the Trip in the app. The old values stay in earlier Revisions until `erase-revisions.sql` erases them, as above.
- **Restriction** (Art. 18) **or objection** (Art. 21): block the Trip (see below) while the request is decided. If the objection holds, erase the Trip.

### Illegal-content notices (DSA Art. 16, 17)

The terms list what a notice must hold and promise that a person, not an automated tool, decides on it.

1. **Acknowledge** the notice without undue delay (Art. 16(4)), at the notifier's address.
2. **Look:** find the Trip by the link in the notice, and read it with `export.sql`. A notice that holds the elements of Art. 16(2) counts as knowledge of the content (Art. 16(3)). From then on, the hosting exemption only holds if illegal content is acted on expeditiously (Art. 6(1)(b)).
3. **Decide** in a timely, diligent, non-arbitrary and objective manner (Art. 16(6)): is the content illegal, or against the terms' content rules? Act in proportion to it (Art. 14(4)).
4. **Act** on the whole Trip, the only unit there are steps for. Prefer `block.sql`: it makes every link to the Trip stop working, but keeps the data, which an authority may ask for. A block can be lifted after a complaint (the command is in the script). Once keeping the data no longer serves a purpose, erase the Trip with `erase.sql`, which finds it blocked or not.
5. **Tell the notifier** the decision without undue delay, and how to contest it: a complaint to `owe-yeah@osieka.dev`, or the courts (Art. 16(5)).
6. **Write the statement of reasons** (Art. 17). The law requires it only for affected users whose email address the operator knows (Art. 17(2)). Send it to those, at the latest when the Trip is blocked or erased. The terms also promise it to anyone who writes with the Trip link, so keep it with the log. It states (Art. 17(3)):
   - what was done (blocked or erased), and for how long;
   - the facts it rests on, and that it followed a notice (naming the notifier only if strictly necessary);
   - that no automated means were used;
   - the law that makes the content illegal, or the terms' rule it breaks;
   - the redress: a complaint to `owe-yeah@osieka.dev`, answered within 14 days, or the courts.
7. **Answer complaints** about a decision within 14 days, as the terms promise. If a complaint is right, lift the block.

Also:

- **Threat to life or safety** (Art. 18): information that suggests a criminal offence threatening someone's life or safety goes promptly to the police of the Member State concerned, with all the information available. If it's unclear which Member State is concerned, it goes to Poland's police or to Europol.
- **Orders from authorities** (Art. 9, 10): act on them, then tell the authority without undue delay what was done and when. Tell the affected users about the order and what was done, wherever there is a way to reach them, such as an address that wrote in about the Trip (Art. 9(5), 10(5)).
- **No transparency reports:** providers that are micro or small enterprises are exempt (Art. 15(2)).

### Breaches (GDPR Art. 33, 34)

A breach is personal data lost, changed, disclosed or accessed without authorisation, whether by accident or not. Examples: the database or a dump of it leaks, the host or one of its secrets is compromised, or Cloudflare reports a breach on its side. The 72 hours start when the operator becomes aware of one.

1. **Contain** it: stop what is leaking, and rotate the secrets that may be out. Rotate the VAPID pair only if it leaked, since a new pair cuts off every subscribed device.
2. **Assess** the risk to people: what data, how many Trips and people, and what could follow. A leaked database exposes Trip names, Participants' names, what they spent, device ids and push subscriptions. It exposes no Trip links, only hashes of their 256-bit random tokens.
3. **Notify UODO** without undue delay, and within 72 hours of becoming aware, unless the breach is unlikely to result in a risk to people (Art. 33(1)). A later notification gives the reasons for the delay. Use UODO's online breach form. It states what happened, what data, roughly how many people and records, the likely consequences, what was done, and a contact (Art. 33(3)). What isn't known yet can follow in phases (Art. 33(4)).
4. **Tell the people affected** without undue delay when the risk is high (Art. 34(1)). Say in plain words what happened, the likely consequences, what was done and whom to contact. There is no way to reach them, so this is a public notice where they'll see it, such as in the app (Art. 34(3)(c)).
5. **Record** every breach, notified or not: the facts, its effects, what was done, and, if it wasn't notified, why not (Art. 33(5)). Keep the record with the Art. 30 record.
