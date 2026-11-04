-- The Trip a Trip link names, and how much is stored with it: one row, or none when the link
-- names no Trip (a wrong or mistyped token, or an erased Trip). A blocked Trip is found too,
-- with `blocked` true. `id` and `token` are the two halves of the link, `/trips/<id>#<token>`.
--
--   psql -U postgres -d owe_yeah -v id=<id> -v token=<token> < find.sql
SELECT encode(sha256(convert_to(:'token', 'UTF8')), 'hex') AS hash \gset
\x on
SELECT
  t.id,
  t.name,
  t.currency,
  t.token_hash LIKE 'blocked:%' AS blocked,
  t.created_at,
  t.updated_at,
  (SELECT count(*) FROM participants p WHERE p.trip_id = t.id) AS participants,
  (SELECT count(*) FROM expenses e WHERE e.trip_id = t.id) AS expenses,
  (SELECT count(*) FROM revisions r WHERE r.trip_id = t.id) AS revisions,
  (SELECT count(*) FROM reminders m WHERE m.trip_id = t.id) AS reminders,
  (SELECT count(*) FROM notification_subscriptions s WHERE s.trip_id = t.id) AS notification_subscriptions
FROM trips t
WHERE t.id = :'id'
  AND t.token_hash IN (:'hash', 'blocked:' || :'hash');
