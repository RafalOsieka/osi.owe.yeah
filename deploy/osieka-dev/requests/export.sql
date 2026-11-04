-- Everything stored about the Trip a Trip link names, as one JSON document; no output when
-- the link names no Trip. Left out: the token's hash, and each push subscription's endpoint
-- and keys, which would let the reader push to the browser of whoever subscribed (only the
-- push service is kept). Keep it in step with the schema: one key per table with a trip_id.
--
--   psql -U postgres -d owe_yeah -At -v id=<id> -v token=<token> < export.sql > trip.json
WITH trip AS (
  SELECT *
  FROM trips
  WHERE id = :'id'
    AND token_hash = encode(sha256(convert_to(:'token', 'UTF8')), 'hex')
)
SELECT jsonb_pretty(jsonb_build_object(
  'trip', to_jsonb(trip) - 'token_hash',
  'participants', (
    SELECT coalesce(jsonb_agg(to_jsonb(p) - 'trip_id' ORDER BY p.created_at), '[]')
    FROM participants p WHERE p.trip_id = trip.id
  ),
  'expenses', (
    SELECT coalesce(jsonb_agg(to_jsonb(e) - 'trip_id' ORDER BY e.created_at), '[]')
    FROM expenses e WHERE e.trip_id = trip.id
  ),
  'revisions', (
    SELECT coalesce(jsonb_agg(to_jsonb(r) - 'trip_id' ORDER BY r.expense_id, r.version), '[]')
    FROM revisions r WHERE r.trip_id = trip.id
  ),
  'changes', (
    SELECT coalesce(jsonb_agg(to_jsonb(c) - 'trip_id' ORDER BY c.created_at), '[]')
    FROM changes c WHERE c.trip_id = trip.id
  ),
  'reminders', (
    SELECT coalesce(jsonb_agg(to_jsonb(m) - 'trip_id' ORDER BY m.sent_at), '[]')
    FROM reminders m WHERE m.trip_id = trip.id
  ),
  'push_subscriptions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'device_id', s.device_id,
      'claim_id', s.claim_id,
      'push_service', substring(s.endpoint FROM '^https://[^/]+'),
      'created_at', s.created_at,
      'updated_at', s.updated_at
    ) ORDER BY s.created_at), '[]')
    FROM notification_subscriptions s WHERE s.trip_id = trip.id
  )
))
FROM trip;
