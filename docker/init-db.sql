-- Runs automatically on first container start against a fresh data volume
-- (Postgres only executes /docker-entrypoint-initdb.d scripts when the data
-- directory is empty). Without this, drizzle/0000_nosy_surge.sql's
-- `vector(1536)` columns fail on any checkout that hasn't manually created
-- the extension.
CREATE EXTENSION IF NOT EXISTS vector;
