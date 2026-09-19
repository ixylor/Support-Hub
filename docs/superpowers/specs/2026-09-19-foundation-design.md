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
- Postgres with the `pgvector` extension, run locally via Docker Compose.
- Drizzle ORM for schema, migrations, and queries.
- Better Auth for agent authentication: email/password and Google OAuth.
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
- A `role` field on the user record, checked by middleware protecting
  `/dashboard/**` routes and by nav rendering (admins see Knowledge Base
  and Analytics links; agents see Tickets).

The mailbox connection (Microsoft Graph OAuth) is a separate credential
flow from agent login — it authorizes the app to access
`support@<company>`'s mail, not a person's session. It is connected once
by an admin from a settings page and stored in `mailbox_connections`.

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
- Env vars: database URL, Better Auth secret, Google OAuth credentials,
  Microsoft Graph app credentials.
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
