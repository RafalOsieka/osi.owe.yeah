# Research: where do Photo files live on a self-hosted instance?

Resolves research ticket #275 ("Where do Photo files live on a self-hosted instance?"), part of map #274 (Photos on Expenses and Receipt scanning). It compares the options and ends with a recommendation; the product and schema decisions stay with the tickets that follow (#281 depends on this one).

Researched on 2026-11-13 from primary docs (PostgreSQL 18 manual, Docker docs, Garage and SeaweedFS docs, the MinIO repository, unstorage/Nitro docs and source, Cloudflare docs, MDN). Versions and licences change, so re-check before committing.

## What Owe Yeah needs

- **Volume.** A few hundred Photos per Trip at about 0.5-1.5 MB each, so roughly 150-450 MB per busy Trip. Ten such Trips are already a few GB, which is more than the rest of the database by orders of magnitude.
- **One self-hosted Docker host**, running the compose stack in `deploy/osieka-dev/compose.yaml`: `db`, a one-shot `backup` (`pg_dump -Fc`, newest 5 kept), the one-shot `migrate`, `app` and `cloudflared`. The app publishes no port; Cloudflare Tunnel is its only way in (ADR 0005).
- **The runtime image holds only Node** (`node:26-alpine` with npm, corepack and yarn removed; `USER node`). Busybox from Alpine is still there.
- **The Trip link is the credential** (ADR 0001). The server checks the Trip id in the route and the token in the `x-trip-token` header (`apps/web/server/utils/trip-access.ts`). Whoever has the link sees every Photo of the Trip.
- **Erase and export** go through `deploy/osieka-dev/requests/erase.sql` and `export.sql`. `erase.sql` relies on every table with a `trip_id` having `ON DELETE CASCADE` from `trips`, and refuses to run otherwise. `export.sql` emits one JSON document, one key per table with a `trip_id`.
- **Standing decisions from #274**: Photos are pictures only, shrunk and EXIF-stripped on the device; they are not part of the whole-Trip pull; other devices fetch a Photo when it is opened and cache it; a scan worker container, optional per instance, claims queued Drafts from a table in the same PostgreSQL.

## Options

### A. PostgreSQL `bytea` column

A `photos` row (`id`, `trip_id`, `expense_id`, size, content type) with the bytes in a `bytea` column.

- **Storage.** A value over about 2 kB is moved out of line into the table's TOAST table; a TOASTed value can be at most 1 GB ([TOAST](https://www.postgresql.org/docs/18/storage-toast.html)). JPEG and WebP don't compress, so the column should be `SET STORAGE EXTERNAL` ("allows out-of-line storage but not compression") to skip a wasted compression attempt (same page). Every read and write handles the whole value as a unit ([Large Objects intro](https://www.postgresql.org/docs/18/lo-intro.html)); at 1.5 MB that is fine.
- **Backup.** This is the cost that rules it out. Every deploy runs `pg_dump -Fc` before migrating, and keeps 5 dumps. Custom format compresses table data with gzip by default ([pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)), which gains nothing on JPEG/WebP. So each dump grows by the full size of every Photo, the `backups` volume holds 5 copies of every Photo, and the off-host mirror (runbook step 7) copies them all after each deploy. Worse, the app is down while the dump runs: compose stops the old app before `backup` and `migrate` run (ADR 0005, consequences), so deploy downtime grows with the Photo collection.
  - `pg_dump --exclude-table-data=photos` keeps dumps small ([pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)), but then the Photos need a backup of their own anyway, which gives up the option's one real advantage (one backup for everything).
- **Erase.** Free: `trip_id` with `ON DELETE CASCADE` and `erase.sql` covers it unchanged, in the same transaction.
- **Export.** `export.sql` would need a `photos` key. `to_jsonb` renders `bytea` as hex text (2 characters per byte, [binary types](https://www.postgresql.org/docs/18/datatype-binary.html)), so the export should list the metadata and write the files separately (`psql` `\copy` or a small script), not inline hex.
- **Runtime image and compose.** Nothing new.
- **Client fetch.** A Nitro route checks the Trip link and returns the bytes from the row. Each request holds a pool connection while 1.5 MB crosses the wire to Node.
- **Scan worker.** Reads the bytes from the same database it already uses for the queue. No shared volume.
- **Moving away later.** A script that reads every row and writes the files out, then a forward-only migration that drops the column. Straightforward, but it's a data migration on the live database.

### B. PostgreSQL large objects

The bytes in `pg_largeobject`, the row holding an `oid`.

- Large objects are for values beyond 1 GB or for partial reads and writes; the manual calls the facility "partially obsolete" next to TOAST ([Large Objects intro](https://www.postgresql.org/docs/18/lo-intro.html)). Photos need neither.
- **Erase breaks.** Large objects live outside the row. Deleting a row doesn't delete the object; without the `lo_manage` trigger they become orphans that "simply occupy disk space", and `DROP`/`TRUNCATE` orphan them even with the trigger; `vacuumlo` is the back-stop ([lo module](https://www.postgresql.org/docs/18/lo.html)). `erase.sql` checks only the `trip_id` cascade, so it would report a clean erasure while the Photo bytes stay.
- **Backup.** Large objects are in the dump by default ([pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) `-b`), with the same bloat and downtime as `bytea`; `-B` leaves them out, with the same consequence.
- **Verdict.** Every cost of A plus an erasure gap. Not considered further.

### C. Filesystem volume next to the Nitro server

A named volume mounted into `app`, for example at `/data/photos`, one directory per Trip: `/data/photos/<trip_id>/<photo_id>`. The `photos` row in PostgreSQL holds the metadata (id, `trip_id` with cascade, `expense_id`, size, content type, maybe a hash), not the bytes.

- **Storage.** Plain files on the host's disk. Writes go to a temporary name, then rename, so a reader never sees half a file. Ids are client-generated UUIDv7s (ADR 0002) validated with zod at the boundary, so they are safe path segments.
  - Nitro already ships unstorage, whose `fs` driver maps keys to files under a `base` directory and has `getItemRaw`/`setItemRaw` and an opt-in `atomic` write ([fs driver docs](https://unstorage.unjs.io/drivers/fs), [source](https://github.com/unjs/unstorage/blob/main/src/drivers/fs.ts)). Its `..` check is only partial (it catches `..:` and a trailing `..`, not `../`), so validate the ids first either way. Plain `node:fs/promises` is just as short; unstorage pays off only if a later switch to S3 should be a config change (see "Moving later").
- **Backup.** The pre-deploy dump stays the size it is today and deploy downtime doesn't grow. The Photos need their own copy off the host: a second volume to mirror in runbook step 7, next to `backups`. Docker documents backing a volume up with a throwaway container running `tar` ([volumes](https://docs.docker.com/engine/storage/volumes/)); an incremental mirror (rsync or similar) suits a growing set of immutable files better. Photos are immutable per id (a changed picture is a new Photo), so the mirror only ever adds and deletes files.
  - A dump restore (rollback) and the Photo volume are no longer one point in time. Rows restored from an older dump can name Photos whose files were deleted since (they show as missing), and files uploaded after the dump have no row (orphans, cleaned by the sweep below).
- **Erase.** `erase.sql` deletes the rows by cascade, but can't touch files. Two cheap pieces close the gap:
  1. The runbook's erasure step adds `docker exec <app container> rm -rf /data/photos/<trip_id>` (busybox `rm` is in the image), and the Trip is gone from the mirror at its next sync, sooner than from the 5 dumps.
  2. A sweep in the app removes any Trip directory whose Trip no longer exists and any file with no `photos` row (older than an upload's grace period). This also covers Photos removed from an Expense, an aborted upload and dump restores.
- **Export.** `export.sql` gets a `photos` key with the metadata rows. The files come out with `docker cp <app container>:/data/photos/<trip_id> ./photos`, which needs no tools in the container.
- **Runtime image and compose.**
  - Dockerfile: create the mount point owned by `node` in the `runtime` stage (`mkdir -p /data/photos && chown node:node /data/photos`). A new named volume mounted over a directory that exists in the image starts as a copy of it, ownership included ([volumes](https://docs.docker.com/engine/storage/volumes/)), so the non-root app can write to it.
  - Compose: a `photos:` volume, mounted read-write into `app`. No new service.
  - The volume outlives container replacement, so deploys don't touch it (same page).
- **Client fetch.** `GET /api/trips/<id>/photos/<photo_id>` with the `x-trip-token` header: the route checks the Trip link, checks the `photos` row belongs to that Trip, and streams the file. Because the credential is a header, not a cookie or URL, an `<img src>` can't load it directly: the client fetches it, stores the `Blob` in the device store (Dexie), and shows it through `URL.createObjectURL`. Content behind a Photo id never changes, so a cached Photo never needs revalidating. The server should still send `Cache-Control: private, no-store`: Cloudflare caches by file extension only and never caches `private`/`no-store` responses ([default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)), and the API path has no extension, so it is doubly safe.
  - Uploads cross Cloudflare, whose request body limit is 100 MB on Free and Pro ([limits](https://developers.cloudflare.com/workers/platform/limits/)), far above a shrunk Photo. The app's own per-Photo limit is the real cap.
  - On the device, IndexedDB and the Cache API share one per-origin quota and are evicted together ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)); Safari deletes script-created data of an origin with no interaction for 7 days of use (same page). The app already asks `navigator.storage.persist()` once a device holds a Trip (`apps/web/app/plugins/storage.client.ts`). A Photo not yet uploaded lives only there, so upload it as soon as the device is online.
- **Scan worker.** A second container on the same host mounts the same volume read-only (`photos:/data/photos:ro`); Docker allows one volume in several containers at once, read-write in some and read-only in others ([volumes](https://docs.docker.com/engine/storage/volumes/)). The queue row gives it the Trip and Photo ids, so it finds the file without the app. The worker image must run as a user that can read files owned by `node` (uid 1000 in the Node images).
  - This ties the worker to the app's host. A worker elsewhere (another machine, a hosted API) would fetch the Photo over HTTP from the app instead, through an internal route or the public one with the Trip link.
- **Moving later.** Copy the files to the new store under the same `<trip_id>/<photo_id>` keys, then switch the module that reads and writes them. With S3 that copy is an `s3 sync`/`rclone` run. No schema change, since the rows never held the bytes.

### D. Self-hosted S3-compatible storage

A storage service in the compose stack; the app talks S3 to it. Unstorage has an `s3` driver on `aws4fetch` that works with "any standards-compatible S3 provider" ([s3 driver](https://unstorage.unjs.io/drivers/s3)).

Candidates as of 2026-11:

- **MinIO: out.** The `minio/minio` repository was archived by the owner on 2026-04-25 and its README says "THIS REPOSITORY IS NO LONGER MAINTAINED". The community edition is source-only: "We will no longer provide pre-compiled binary releases for the community version." Prebuilt images aren't offered; MinIO points to its AIStor products instead. The source stays AGPLv3 ([minio/minio](https://github.com/minio/minio)). Running it would mean building and patching an abandoned server ourselves.
- **Garage.** AGPLv3 ([mirror README](https://github.com/deuxfleurs-org/garage)), single binary, built for small self-hosted and geo-distributed clusters; needs about 1 GB RAM and 16 GB disk ([garagehq.deuxfleurs.fr](https://garagehq.deuxfleurs.fr/)). Single node: image `dxflrs/garage:v2.5.0`, `replication_factor = 1`, SQLite metadata, and since v2.3.0 `garage server --single-node --default-bucket` creates the layout, key and bucket itself; the docs warn a single node has no redundancy and is not for production ([quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/)). It has presigned URLs, `DeleteObjects`, CORS and partial lifecycle (expiration only); no versioning, object lock or bucket policies ([S3 compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)). Owe Yeah would need none of the missing ones. Running it unmodified as a separate service raises no AGPL obligation for the app.
- **SeaweedFS.** Apache-2.0, "optimized for small files", packs them into append-only volume files. `weed mini -dir=./data` runs master, volume server, filer, S3 gateway, WebDAV, an Iceberg catalog and an admin UI in one process; the multi-container compose is the usual production form ([seaweedfs/seaweedfs](https://github.com/seaweedfs/seaweedfs)). Built for billions of files; for a few GB it is a lot of moving parts.

What S3 changes against C, on one host:

- **Backup.** The store has its own data and metadata directories to back up consistently (data plus Garage's SQLite metadata), instead of a directory of plain files. No gain over C on one node.
- **Erase.** Same gap as C: `erase.sql` can't reach the bucket. Delete the `<trip_id>/` prefix (`DeleteObjects` after a list) from the runbook or the sweep.
- **Export.** An S3 client (`aws s3 cp --recursive`, `rclone`) on the operator's machine or a throwaway container, against a port that isn't published, instead of `docker cp`.
- **Runtime image and compose.** A new stateful service with its own config, secrets (S3 key, RPC secret, admin token), volumes, healthcheck and upgrade path. The runtime image needs nothing: the S3 client is `fetch`-based.
- **Client fetch.** No different from C. Presigned URLs would let the browser skip the app, but the tunnel exposes only the app, and the Trip link check must run in the app anyway, so the app proxies every Photo. Exposing the store through a second tunnel hostname to use presigned URLs adds surface for little gain at this size.
- **Scan worker.** Reads over the compose network with an S3 key, and can run on another host with no shared volume. This is the one real advantage, and it only matters if the worker moves off the host.
- **Moving later.** To a hosted S3 (R2, B2, Hetzner, Scaleway) it's a bucket copy and an endpoint change: cheapest of all.

## Comparison

|                               | A. `bytea`                                   | C. Volume                                      | D. Garage / SeaweedFS                |
| ----------------------------- | -------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| Dump size and deploy downtime | Grow with every Photo, 5 copies kept         | Unchanged                                      | Unchanged                            |
| Off-host backup               | Already there (inside dumps)                 | One more volume to mirror                      | Store's data + metadata to mirror    |
| Erase by `erase.sql`          | Covered by cascade                           | Rows only; `rm -rf` the Trip directory + sweep | Rows only; delete the prefix + sweep |
| Export                        | `photos` key + files written out by a script | `photos` key + `docker cp`                     | `photos` key + S3 client             |
| New services                  | None                                         | None (one volume)                              | One stateful service                 |
| Scan worker on the same host  | Reads from DB                                | Mounts volume `:ro`                            | S3 over compose network              |
| Scan worker on another host   | Reads from DB                                | Via the app over HTTP                          | S3 directly                          |
| Later move                    | Data migration out of the live DB            | File copy, same keys                           | Bucket copy, endpoint change         |

## Recommendation

**C: a named volume next to the Nitro server, one directory per Trip, with the metadata in a `photos` table that has `trip_id` and the cascade.**

- It keeps the pre-deploy dump and the deploy's downtime the size they are today, which `bytea` can't, and adds no stateful service, which S3 can't.
- The erasure gap is small and explicit: one `rm -rf` in the runbook and a sweep in the app, both keyed by the Trip id that is the directory name.
- A same-host scan worker reads the files from a read-only mount; one on another host goes through the app.
- Keep the file I/O behind one small server module keyed by `<trip_id>/<photo_id>`. Keys that already look like S3 keys make a later move to Garage or a hosted bucket a file copy plus a module or unstorage driver swap, with no schema change.
- Not MinIO in any case: its community edition is archived and ships no binaries.

## Open questions for later tickets

- **Restore and Photo volume drift.** After restoring a dump, some rows may name Photos whose files are gone. Does the app show these as "unavailable", or should file deletion wait (for example until the dump that held the row is pushed out)? Waiting conflicts with prompt erasure.
- **Sweep timing and the upload grace period.** When does the sweep run (on start-up, daily via a Nitro task) and how old must a file without a row be before it goes?
- **Upload order.** File first then row (orphans possible, the sweep cleans them) or row first with a "pending" state (a row without a file possible). The first fits offline retries with client ids.
- **Off-host copy.** Runbook step 7 mirrors `backups`; the Photo volume needs the same, and the privacy notice should say Photos are kept there and leave at the next mirror after erasure.
- **Per-Trip storage limit.** Store each Photo's size in its row, so the per-Trip limit is a `SUM` without touching the disk.
- **Worker uid.** If the scan worker image doesn't run as uid 1000, it needs group read access or the app writes files group-readable.
