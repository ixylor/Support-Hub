-- Runs automatically on first container start against a fresh data volume
-- (Postgres only executes /docker-entrypoint-initdb.d scripts when the data
-- directory is empty). Without this, drizzle/0000_nosy_surge.sql's
-- `vector(1536)` columns fail on any checkout that hasn't manually created
-- the extension.
CREATE EXTENSION IF NOT EXISTS vector;

-- A second, isolated database for the Vitest and Playwright suites (see
-- TEST_DATABASE_URL in .env.example), so running tests never touches real
-- data in support_hub. Same fresh-volume-only caveat as above — an existing
-- volume needs the one-off command documented in the README.
CREATE DATABASE support_hub_test;

\connect support_hub_test

CREATE EXTENSION IF NOT EXISTS vector;
