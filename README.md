# Support Hub

An internal support ticketing app with role-aware agent/admin access, backed
by Postgres (with `pgvector` for knowledge-base embeddings) and Better Auth.

## Prerequisites

- Node.js and [pnpm](https://pnpm.io)
- Docker (for local Postgres)

## Setup

1. Start Postgres:

   ```bash
   docker compose up -d postgres
   ```

   The `pgvector` extension is created automatically on first start via
   `docker/init-db.sql`, which Postgres only runs against a fresh data
   volume (i.e. the first time the `postgres_data` volume is created). If
   you already have an existing volume from before this script existed,
   create the extension manually once:

   ```bash
   docker compose exec postgres psql -U support_hub -d support_hub -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

2. Copy the example environment file and fill it in:

   ```bash
   cp .env.example .env
   ```

   Generate a value for `APP_ENCRYPTION_KEY` (the master key used to
   encrypt OAuth app credentials at rest):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Also set `BETTER_AUTH_SECRET` to a random string, and adjust
   `DATABASE_URL` if Postgres isn't reachable on the default port (e.g. if
   something else on your machine already uses 5432).

3. Install dependencies:

   ```bash
   pnpm install
   ```

4. Run database migrations:

   ```bash
   pnpm db:migrate
   ```

5. Start the dev server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Running the tests

Vitest and Playwright run against a second database, `support_hub_test`, in
the same Postgres container — never against the database from step 1 above.
This means running the suites can't touch real data (tickets, connected
mailboxes, etc.) in your dev database.

1. Create the test database once. On a fresh checkout this already exists —
   `docker/init-db.sql` creates it automatically, the same way it creates
   `pgvector`. On a pre-existing Postgres volume (e.g. you set this up before
   the test database existed), create it by hand instead:

   ```bash
   docker compose exec postgres psql -U support_hub -d support_hub -c "CREATE DATABASE support_hub_test;"
   docker compose exec postgres psql -U support_hub -d support_hub_test -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

2. Set `TEST_DATABASE_URL` in `.env` (see `.env.example`) — same host/user/
   password as `DATABASE_URL`, but naming `support_hub_test`.

3. Apply migrations to it:

   ```bash
   pnpm db:migrate:test
   ```

4. Run the suites:

   ```bash
   pnpm test       # Vitest — uses TEST_DATABASE_URL automatically
   pnpm test:e2e   # Playwright — spawns its own dev server on port 3100
                    # against the test database; your `pnpm dev` on port
                    # 3000 (dev database) can keep running at the same time
   ```

Both configs refuse to run if `TEST_DATABASE_URL` is unset or identical to
`DATABASE_URL`, rather than risk running against the dev database.

## Scripts

- `pnpm dev` — start the Next.js dev server
- `pnpm build` / `pnpm start` — production build and run
- `pnpm lint` — lint the codebase
- `pnpm test` / `pnpm test:watch` — Vitest unit/component tests (test database)
- `pnpm test:e2e` — Playwright end-to-end tests (test database)
- `pnpm db:generate` — generate a Drizzle migration from schema changes
- `pnpm db:migrate` — apply pending migrations to the dev database
- `pnpm db:migrate:test` — apply pending migrations to the test database

## Notes

- Google OAuth (platform login) credentials are set via `.env`
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) — they're a bootstrap
  dependency the app needs to start, like `DATABASE_URL`.
- Admin-managed integration credentials (e.g. the Microsoft Graph mailbox
  connection, added in the Ticket Ingestion phase) are stored encrypted in
  the `app_secrets` table instead, so they can be entered and rotated
  through the dashboard without a redeploy.
