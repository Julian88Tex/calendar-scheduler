-- Custom migration (ARCHITECTURE section 5.4.21). btree_gist is reserved for future exclusion constraints; PGlite
-- loads it explicitly and Neon and Supabase support it. No exclusion constraint on meetings is used: race safety comes
-- from transaction advisory locks (SCH-20).
CREATE EXTENSION IF NOT EXISTS btree_gist;
