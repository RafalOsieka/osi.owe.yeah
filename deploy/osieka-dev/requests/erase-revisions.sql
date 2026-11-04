-- Erases an Expense's earlier Revisions, keeping only the version it is at: for when the
-- Expense was corrected (or edited, then deleted) in the app and the old values must go too.
-- `expense` is the Expense's id, from `export.sql`. Says DELETE <n>; DELETE 0 when the link
-- names no Trip, the Expense isn't in it, or it has no earlier Revision.
--
--   psql -U postgres -d owe_yeah -v id=<id> -v token=<token> -v expense=<expense id> < erase-revisions.sql
--
-- Safe for the app: Revisions are read from the server whenever they are shown, the Trip
-- names who made each Expense's current version from its current Revision, and
-- Notifications compare a new version only with the one before it, the current one.
SELECT encode(sha256(convert_to(:'token', 'UTF8')), 'hex') AS hash \gset
DELETE FROM revisions r
USING expenses e, trips t
WHERE r.expense_id = e.id
  AND r.version < e.version
  AND e.id = :'expense'
  AND e.trip_id = t.id
  AND t.id = :'id'
  AND t.token_hash IN (:'hash', 'blocked:' || :'hash');
