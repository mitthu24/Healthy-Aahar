-- Extensions the application relies on (docs/03-TECH-STACK.md section 5).
-- Created at container init so a fresh `docker compose up` is immediately
-- ready for `prisma migrate dev`. The migration creates them too (IF NOT
-- EXISTS), so this is belt-and-braces for local convenience.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
