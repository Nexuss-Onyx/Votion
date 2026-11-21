-- Required PostgreSQL extensions (Neon / Supabase / self-hosted PG 16).
-- `gen_random_uuid()` is built into PG 13+, but these extensions guarantee
-- compatibility with older managed clusters and unlock digest/vector helpers.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
