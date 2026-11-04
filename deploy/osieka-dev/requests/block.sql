-- Blocks the Trip a Trip link names: every link to it stops working, as if it were erased,
-- but its data stays, so a decision can be reviewed and the block lifted. The other scripts
-- still find, export and erase it by its link. Says UPDATE 1, or UPDATE 0 when the link
-- names no Trip or it is blocked already. A device that still syncs it can't bring it back:
-- the Trip's id is taken.
--
--   psql -U postgres -d owe_yeah -v id=<id> -v token=<token> < block.sql
--
-- To lift the block, by id alone:
--
--   UPDATE trips SET token_hash = substr(token_hash, 9)
--   WHERE id = '<id>' AND token_hash LIKE 'blocked:%';
UPDATE trips
SET token_hash = 'blocked:' || token_hash
WHERE id = :'id'
  AND token_hash = encode(sha256(convert_to(:'token', 'UTF8')), 'hex');
