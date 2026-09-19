# Support Hub

An internal support ticketing app with role-aware agent/admin access, backed
by Postgres (with `pgvector` for future knowledge-base embeddings) and
Better Auth.

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

## Scripts

- `pnpm dev` — start the Next.js dev server
- `pnpm build` / `pnpm start` — production build and run
- `pnpm lint` — lint the codebase
- `pnpm test` / `pnpm test:watch` — Vitest unit/component tests
- `pnpm test:e2e` — Playwright end-to-end tests
- `pnpm db:generate` — generate a Drizzle migration from schema changes
- `pnpm db:migrate` — apply pending migrations

## Notes

- Google OAuth and Microsoft Graph credentials are entered through the
  admin-only Integrations settings page and stored encrypted in the
  `app_secrets` table — they are never set via `.env`.
