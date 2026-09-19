# Foundation Design

Status: approved
Date: 2026-09-19

## Context

This is the first of seven phases building an AI-powered customer support
system (see project overview). Build order, agreed during brainstorming:

Foundation -> Ticket Ingestion -> Knowledge Base -> AI Response Pipeline ->
Human-in-the-loop Review -> Sending -> Analytics.

Each phase gets its own spec, implementation plan, and review cycle. This
document scopes Foundation only: the data model, auth, and scaffolding
every later phase builds on. It does not implement ingestion, KB embedding,
AI drafting, or analytics logic — those phases will implement behavior
against the schema defined here.

## Goals

- Stand up local dev infrastructure (Postgres + pgvector via Docker,
  Drizzle ORM, migrations).
- Implement agent authentication (Better Auth) with role separation
  (`agent`, `admin`).
- Define the full core database schema up front, so later phases add
  behavior rather than redesign data structures.
- Scaffold a role-aware dashboard shell (protected routes, nav, branding).
- Set up the testing stack (Vitest + Playwright) so every later phase adds
  tests as it goes.

## Out of scope

- Reading/sending real email (Ticket Ingestion, Sending phases).
- KB chunking/embedding logic (Knowledge Base phase).
- AI draft generation, retrieval, classification (AI Response Pipeline
  phase, built on LangGraph).
- Analytics queries and charts (Analytics phase).
- Real ticket/ticket-message UI beyond a placeholder list view.

## Stack

- Next.js (App Router), React, existing shadcn/Tailwind setup.
- Mutations are exposed as Next.js Route Handlers (`app/api/**/route.ts`)
  rather than Server Actions. This keeps every mutation reachable as a
  plain HTTP endpoint — useful once other phases add non-browser callers
  (webhooks, background workers, scripts) — and keeps the request/response
  contract explicit rather than implicit in a form's `action` binding.
- Postgres with the `pgvector` extension, run locally via Docker Compose.
- Drizzle ORM for schema, migrations, and queries.
- Better Auth for agent authentication: email/password and Google OAuth.
- AES-256-GCM encryption (Node's built-in `crypto` module) for OAuth app
  credentials stored in `app_secrets`, keyed by a single `APP_ENCRYPTION_KEY`
  env var.
- Vitest + React Testing Library for unit/component tests; Playwright for
  end-to-end flows and anything involving async Server Components (which
  Vitest cannot render).
- LangGraph.js is adopted as the orchestration library starting in the AI
  Response Pipeline phase. Foundation only reserves a schema column for
  its checkpoint/thread reference so that phase does not require a
  migration on `ticket_ai_drafts`.

## Data model

All tables live in a Drizzle schema module. Naming: snake_case columns,
plural table names.

### `users` (extends Better Auth's user table)

- Better Auth's standard columns (id, email, name, etc.)
- `role`: enum `agent` | `admin`, default `agent`

### `mailbox_connections`

Represents the single shared team mailbox connected via Microsoft Graph
OAuth. One active row is expected; the table is not designed for
per-agent mailboxes.

- `id`
- `provider`: enum, `microsoft` (only value for now, kept as enum so a
  second provider is additive later)
- `mailbox_address`
- `encrypted_refresh_token`
- `connected_by_user_id` (FK -> users.id)
- `status`: enum `active` | `disconnected` | `error`
- `created_at`, `updated_at`

### `tickets`

- `id`
- `subject`
- `requester_email`
- `status`: enum `new` | `pending_review` | `approved` | `escalated` |
  `resolved` | `waiting_on_customer`
- `category`: enum `billing` | `technical` | `general` | `other`, nullable
  until classified
- `priority`: enum `low` | `medium` | `high` | `urgent`, nullable until
  classified
- `confidence_score`: numeric, nullable until classified
- `created_at`, `updated_at`

### `ticket_messages`

- `id`
- `ticket_id` (FK -> tickets.id)
- `direction`: enum `inbound` | `outbound`
- `sender_email`
- `body`
- `message_id_header` (for threading match)
- `in_reply_to_header` (for threading match)
- `sent_at`

### `attachments`

- `id`
- `ticket_message_id` (FK -> ticket_messages.id)
- `filename`
- `storage_path`
- `content_type`
- `size_bytes`

### `kb_entries`

- `id`
- `title`
- `content`
- `created_at`, `updated_at`

### `kb_chunks`

- `id`
- `kb_entry_id` (FK -> kb_entries.id)
- `chunk_index`
- `chunk_text`
- `embedding`: `vector` (pgvector column)

### `prompt_templates`

Admin-editable prompts used by the AI Response Pipeline. Versioned so a
live edit does not retroactively change what an in-flight draft used.

- `id`
- `key` (e.g. `draft_reply_system`)
- `content`
- `version`
- `is_active`: boolean, exactly one active row per `key`
- `updated_by_user_id` (FK -> users.id)
- `created_at`

### `ticket_ai_drafts`

- `id`
- `ticket_id` (FK -> tickets.id)
- `draft_body`
- `cited_kb_chunk_ids`: array of `kb_chunks.id`
- `confidence_score`
- `prompt_template_id` (FK -> prompt_templates.id) — which prompt version
  produced this draft
- `graph_thread_id` — LangGraph checkpoint/thread reference, so an
  interrupted pipeline run (paused for human review) can be resumed;
  populated starting in the AI Response Pipeline phase
- `created_at`

### `app_secrets`

Holds OAuth app credentials (Google, Microsoft Graph) encrypted at rest,
so they don't sit as plaintext in `.env`. The decryption key itself
(`APP_ENCRYPTION_KEY`) and `DATABASE_URL` are the only credentials that
must still live in the environment — a value used to reach or unlock the
database cannot itself be stored in the database.

- `id`
- `key` (e.g. `google_client_id`, `google_client_secret`,
  `microsoft_graph_client_id`, `microsoft_graph_client_secret`,
  `microsoft_graph_tenant_id`), unique
- `encrypted_value`
- `updated_by_user_id` (FK -> users.id)
- `updated_at`

### `llm_logs`

For debugging; PII beyond what's operationally necessary is not logged.

- `id`
- `ticket_id` (FK -> tickets.id, nullable)
- `prompt`
- `response`
- `model`
- `created_at`

## Auth

Better Auth is configured with:

- Email/password provider
- Google OAuth provider
- A `role` field on the user record, checked by route-protection logic
  guarding `/dashboard/**` (implemented as `proxy.ts` — Next.js 16 renamed
  Edge middleware to a Node-runtime "proxy" convention) and by nav
  rendering (admins see Knowledge Base and Analytics links; agents see
  Tickets).

The mailbox connection (Microsoft Graph OAuth) is a separate credential
flow from agent login — it authorizes the app to access
`support@<company>`'s mail, not a person's session. It is connected once
by an admin from a settings page and stored in `mailbox_connections`.

Google's OAuth app credentials (client ID/secret) are read from
`app_secrets` (decrypted with `APP_ENCRYPTION_KEY`) rather than from
`.env`. Because Better Auth's server instance is constructed once at
module load, a credential change made through the admin settings page
takes effect on the next server restart, not live — this is an accepted
tradeoff for Foundation; the alternative (a fully dynamic auth config)
adds complexity this phase doesn't need. Microsoft Graph credentials are
stored the same way and read by the Ticket Ingestion phase.

## Scaffolding

- `docker-compose.yml`: Postgres with `pgvector` extension enabled for
  local dev.
- Drizzle config, schema module, and initial migration.
- Better Auth wired into Next.js route handlers, with middleware
  protecting dashboard routes.
- Dashboard shell: login page, protected `/dashboard` layout, role-aware
  navigation.
- `components/branding/logo.tsx`: a single shared logo component
  rendering a styled text wordmark for now (app name via existing
  Tailwind/shadcn theme). Used in the login page and dashboard
  header/sidebar. Swapping to a real mark later touches only this file.
- Env vars: database URL, Better Auth secret, and `APP_ENCRYPTION_KEY`
  (the master key for `app_secrets`). Google OAuth and Microsoft Graph
  credentials are entered once through an admin settings page and stored
  encrypted in `app_secrets`, not in `.env`.
- `app/dashboard/settings/integrations/page.tsx`: admin-only form to set
  Google and Microsoft Graph OAuth credentials.
- Vitest config (`vitest.config.mts`) and Playwright config, with test
  scripts in `package.json`.

## Testing

- Unit/component: one Vitest test per component/unit added during this
  phase (e.g. `Logo`, role-aware nav rendering, middleware redirect
  logic where it can be isolated).
- E2E (Playwright): login (email/password and Google OAuth happy path),
  unauthenticated access to `/dashboard` redirects to login, admin vs
  agent nav differs after login.
- Schema: a migration smoke test that runs migrations against a fresh
  local Postgres+pgvector instance and confirms all tables/enums exist.

## Conventions

- No mentions of AI-assistant tooling anywhere in code, comments, commit
  messages, or docs for this project.
- Comments explain non-obvious "why" only; no restating what code does.
