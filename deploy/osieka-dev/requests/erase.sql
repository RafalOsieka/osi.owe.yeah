-- Erases the Trip a Trip link names, with everything stored with it: Participants, Expenses,
-- Revisions, changes, notification subscriptions and Reminders, blocked or not. Exchange
-- rates hold no Trip data.
--
--   psql -U postgres -d owe_yeah -v id=<id> -v token=<token> < erase.sql
--
-- Says "Erased Trip <id>". Otherwise it erases nothing and fails with the reason: a table
-- with a trip_id that isn't deleted with the Trip (no foreign key to trips ON DELETE
-- CASCADE: fix the schema first), no Trip with this id and token, or rows left behind.
-- The checks and the delete are one statement, so one transaction.
\set ON_ERROR_STOP on
SET erase.trip_id = :'id';
SELECT encode(sha256(convert_to(:'token', 'UTF8')), 'hex') AS hash \gset
SET erase.token_hash = :'hash';

DO $$
DECLARE
  erased uuid := current_setting('erase.trip_id');
  hash text := current_setting('erase.token_hash');
  holders text[];
  uncovered text;
  holder text;
  left_over boolean;
BEGIN
  -- Every table that holds rows of a Trip keeps its id in trip_id.
  SELECT array_agg(table_name::text ORDER BY table_name) INTO holders
  FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'trip_id';

  SELECT string_agg(h, ', ') INTO uncovered
  FROM unnest(holders) AS h
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.contype = 'f'
      AND k.conrelid = format('public.%I', h)::regclass
      AND k.confrelid = 'public.trips'::regclass
      AND k.confdeltype = 'c'
      AND a.attname = 'trip_id'
  );
  IF uncovered IS NOT NULL THEN
    RAISE EXCEPTION 'Nothing erased: % would keep rows of the Trip (no ON DELETE CASCADE from trips)', uncovered;
  END IF;

  DELETE FROM trips
  WHERE id = erased
    AND token_hash IN (hash, 'blocked:' || hash);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nothing erased: no Trip has this id and token';
  END IF;

  FOREACH holder IN ARRAY holders LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE trip_id = $1)', holder)
      INTO left_over USING erased;
    IF left_over THEN
      RAISE EXCEPTION 'Nothing erased: % still holds rows of the Trip', holder;
    END IF;
  END LOOP;

  RAISE NOTICE 'Erased Trip %', erased;
END
$$;
