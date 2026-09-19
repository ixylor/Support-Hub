# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared infrastructure — local Postgres/pgvector, Drizzle ORM with the full core schema, Better Auth with role-based access, a role-aware dashboard shell, and the Vitest/Playwright testing stack — that every later phase of the support system builds on.

**Architecture:** Next.js App Router talks to Postgres through Drizzle ORM. Better Auth (Drizzle adapter) owns authentication and is mounted as a catch-all route handler; a `role` field distinguishes `agent` from `admin`. Middleware gates `/dashboard/**`. Domain tables (tickets, KB, prompts, AI drafts, mailbox connection) are defined now so later phases add behavior, not schema.

**Tech Stack:** Next.js (App Router), React, Drizzle ORM, `postgres` driver, Better Auth, Docker Compose (Postgres + pgvector), Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-foundation-design.md`

## Global Constraints

- No mentions of AI-assistant tooling anywhere in code, comments, commit messages, or docs.
- Comments explain non-obvious "why" only; never restate what the code does.
- Postgres runs locally via Docker Compose with the `pgvector` extension enabled.
- Drizzle ORM for schema, migrations, and queries; snake_case columns, plural table names.
- Better Auth: email/password + Google OAuth, `role` enum (`agent` | `admin`) on the user record.
- Mailbox connection (Microsoft Graph OAuth) is a separate credential flow from agent login, stored in `mailbox_connections`, connected once by an admin — no OAuth flow is implemented in this phase, only the table.
- Vitest + React Testing Library for unit/component tests; Playwright for E2E and anything touching async Server Components.
- `ticket_ai_drafts.graph_thread_id` is reserved now for LangGraph's checkpoint/thread reference; it is not populated until the AI Response Pipeline phase.

---

## File Structure

- `docker-compose.yml` — local Postgres + pgvector
- `.env.example` — documents required env vars
- `drizzle.config.ts` — Drizzle Kit config
- `lib/db/schema.ts` — full domain schema (tickets, messages, attachments, KB, prompts, drafts, logs, mailbox connection)
- `lib/db/client.ts` — Drizzle client singleton
- `lib/auth/schema.ts` — Better Auth's Drizzle schema, extended with `role`
- `lib/auth/server.ts` — Better Auth server instance (providers, adapter, role field)
- `lib/auth/client.ts` — Better Auth React client (hooks used by pages)
- `app/api/auth/[...all]/route.ts` — Better Auth route handler
- `middleware.ts` — protects `/dashboard/**`, redirects unauthenticated requests to `/login`
- `components/branding/logo.tsx` — shared wordmark component
- `app/login/page.tsx` — login page (email/password + Google)
- `app/dashboard/layout.tsx` — protected layout, renders nav
- `app/dashboard/page.tsx` — placeholder landing page
- `app/dashboard/settings/prompts/page.tsx` — admin-only prompt template editor
- `components/dashboard/nav.tsx` — role-aware navigation
- `lib/prompt-templates.ts` — pure versioning logic (activate a new version, deactivate the previous one) plus data-access functions
- `app/dashboard/settings/prompts/actions.ts` — server actions calling `lib/prompt-templates.ts`
- `vitest.config.mts`, `vitest.setup.ts` — unit/component test config
- `playwright.config.ts` — E2E test config
- `e2e/` — Playwright specs
- Component/unit tests colocated as `*.test.tsx` next to the file they cover

---

### Task 1: Project scaffolding — Docker, env, test runners

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `vitest.config.mts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Modify: `package.json` (scripts + devDependencies)
- Test: `lib/utils.test.ts`

**Interfaces:**
- Produces: `pnpm test` (Vitest, watch off in CI via `--run`), `pnpm test:e2e` (Playwright) — later tasks' tests run through these.

- [ ] **Step 1: Add Docker Compose for local Postgres + pgvector**

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: support_hub
      POSTGRES_PASSWORD: support_hub
      POSTGRES_DB: support_hub
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

- [ ] **Step 2: Document required env vars**

```bash
# .env.example
DATABASE_URL=postgres://support_hub:support_hub@localhost:5432/support_hub
BETTER_AUTH_SECRET=replace-with-a-32-byte-random-string
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_GRAPH_CLIENT_ID=
MICROSOFT_GRAPH_CLIENT_SECRET=
MICROSOFT_GRAPH_TENANT_ID=
```

- [ ] **Step 3: Install test dependencies**

Run: `pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths @playwright/test`

- [ ] **Step 4: Add Vitest config and setup file**

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

Run: `pnpm add -D @testing-library/jest-dom`

- [ ] **Step 5: Add Playwright config**

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
```

- [ ] **Step 6: Add test scripts to package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test"
```

- [ ] **Step 7: Write the first real unit test to prove the runner works**

```ts
// lib/utils.test.ts
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names, dropping falsy values", () => {
    expect(cn("a", false, "b", undefined)).toBe("a b");
  });
});
```

- [ ] **Step 8: Run it**

Run: `pnpm test`
Expected: PASS (1 test)

- [ ] **Step 9: Bring up Postgres and confirm pgvector is available**

Run: `docker compose up -d postgres`
Run: `docker compose exec postgres psql -U support_hub -d support_hub -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname = 'vector';"`
Expected: the query returns one row, `vector`.

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml .env.example vitest.config.mts vitest.setup.ts playwright.config.ts package.json pnpm-lock.yaml lib/utils.test.ts
git commit -m "Add local Postgres/pgvector, Vitest, and Playwright scaffolding"
```

---

### Task 2: Drizzle ORM + domain schema + migration

**Files:**
- Create: `drizzle.config.ts`
- Create: `lib/db/schema.ts`
- Create: `lib/db/client.ts`
- Create: `lib/db/schema.test.ts`
- Modify: `.env.example` (no change needed, `DATABASE_URL` already present)
- Modify: `package.json` (scripts + dependencies)

**Interfaces:**
- Produces: `db` (Drizzle client, from `lib/db/client.ts`), and every table export from `lib/db/schema.ts`: `tickets`, `ticketMessages`, `attachments`, `kbEntries`, `kbChunks`, `promptTemplates`, `ticketAiDrafts`, `llmLogs`, `mailboxConnections`, plus their enum exports (`ticketStatusEnum`, `ticketCategoryEnum`, `ticketPriorityEnum`, `messageDirectionEnum`, `mailboxProviderEnum`, `mailboxStatusEnum`).
- Consumes: nothing (first schema task).

- [ ] **Step 1: Install Drizzle and the Postgres driver**

Run: `pnpm add drizzle-orm postgres`
Run: `pnpm add -D drizzle-kit`

- [ ] **Step 2: Add Drizzle Kit config**

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./lib/db/schema.ts", "./lib/auth/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 3: Write the domain schema**

```ts
// lib/db/schema.ts
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  vector,
} from "drizzle-orm/pg-core";
import { user } from "@/lib/auth/schema";

export const mailboxProviderEnum = pgEnum("mailbox_provider", ["microsoft"]);
export const mailboxStatusEnum = pgEnum("mailbox_status", [
  "active",
  "disconnected",
  "error",
]);

// A single shared team mailbox connected via Microsoft Graph OAuth.
// Not designed for per-agent mailboxes — see Foundation spec.
export const mailboxConnections = pgTable("mailbox_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: mailboxProviderEnum("provider").notNull(),
  mailboxAddress: text("mailbox_address").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedByUserId: text("connected_by_user_id")
    .notNull()
    .references(() => user.id),
  status: mailboxStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ticketStatusEnum = pgEnum("ticket_status", [
  "new",
  "pending_review",
  "approved",
  "escalated",
  "resolved",
  "waiting_on_customer",
]);
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "billing",
  "technical",
  "general",
  "other",
]);
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  subject: text("subject").notNull(),
  requesterEmail: text("requester_email").notNull(),
  status: ticketStatusEnum("status").notNull().default("new"),
  category: ticketCategoryEnum("category"),
  priority: ticketPriorityEnum("priority"),
  confidenceScore: numeric("confidence_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const ticketMessages = pgTable("ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id),
  direction: messageDirectionEnum("direction").notNull(),
  senderEmail: text("sender_email").notNull(),
  body: text("body").notNull(),
  messageIdHeader: text("message_id_header"),
  inReplyToHeader: text("in_reply_to_header"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketMessageId: uuid("ticket_message_id")
    .notNull()
    .references(() => ticketMessages.id),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
});

export const kbEntries = pgTable("kb_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Dimensions match Azure OpenAI's text-embedding-3-small; revisit if the
// embedding model changes in the AI Response Pipeline phase.
export const kbChunks = pgTable("kb_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  kbEntryId: uuid("kb_entry_id")
    .notNull()
    .references(() => kbEntries.id),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
});

export const promptTemplates = pgTable("prompt_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedByUserId: text("updated_by_user_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ticketAiDrafts = pgTable("ticket_ai_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id),
  draftBody: text("draft_body").notNull(),
  citedKbChunkIds: uuid("cited_kb_chunk_ids").array().notNull().default([]),
  confidenceScore: numeric("confidence_score").notNull(),
  promptTemplateId: uuid("prompt_template_id")
    .notNull()
    .references(() => promptTemplates.id),
  // LangGraph checkpoint/thread reference, populated starting in the AI
  // Response Pipeline phase so an interrupted run can resume.
  graphThreadId: text("graph_thread_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const llmLogs = pgTable("llm_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").references(() => tickets.id),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

> **Note for the implementer:** confirm `vector` is exported from the installed `drizzle-orm/pg-core` version (`pnpm ls drizzle-orm`). If it is not yet available in the resolved version, upgrade `drizzle-orm` until it is — pgvector support must come from the library, not a hand-rolled custom type, so migrations stay generator-compatible.

- [ ] **Step 4: Add the Drizzle client singleton**

```ts
// lib/db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as authSchema from "@/lib/auth/schema";

const queryClient = postgres(process.env.DATABASE_URL!);

export const db = drizzle(queryClient, { schema: { ...schema, ...authSchema } });
```

- [ ] **Step 5: Add schema-shape smoke test**

This does not require a live database — it checks the exported table objects carry the columns later tasks depend on, catching typos before a migration is even generated.

```ts
// lib/db/schema.test.ts
import { describe, expect, it } from "vitest";
import { promptTemplates, ticketAiDrafts, tickets } from "./schema";

describe("domain schema", () => {
  it("exposes the columns the AI pipeline phase will rely on", () => {
    expect(Object.keys(ticketAiDrafts)).toEqual(
      expect.arrayContaining(["graphThreadId", "promptTemplateId", "confidenceScore"])
    );
  });

  it("exposes the columns the review dashboard will rely on", () => {
    expect(Object.keys(tickets)).toEqual(
      expect.arrayContaining(["status", "category", "priority"])
    );
  });

  it("supports versioned prompt templates", () => {
    expect(Object.keys(promptTemplates)).toEqual(
      expect.arrayContaining(["key", "version", "isActive"])
    );
  });
});
```

- [ ] **Step 6: Run it**

Run: `pnpm test lib/db/schema.test.ts`
Expected: PASS (3 tests) — this only exercises Drizzle's in-memory table definitions, not a database connection, so it passes before migrations exist.

- [ ] **Step 7: Commit**

(Committed together with Task 3, once the auth schema it references exists — Drizzle Kit needs both schema files to generate one consistent migration. Skip the commit here.)

---

### Task 3: Better Auth — schema, server, client, route handler

**Files:**
- Create: `lib/auth/schema.ts`
- Create: `lib/auth/server.ts`
- Create: `lib/auth/client.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Create: `lib/auth/server.test.ts`
- Modify: `package.json`, `.env.example` (already has the needed vars)

**Interfaces:**
- Produces: `auth` (Better Auth server instance, `lib/auth/server.ts`), `authClient` with `signIn`, `signUp`, `signOut`, `useSession` (`lib/auth/client.ts`), `user` table export (`lib/auth/schema.ts`, consumed by Task 2's foreign keys).
- Consumes: `db` from `lib/db/client.ts` is NOT used here — Better Auth needs its own un-augmented client to avoid a circular import with `lib/db/schema.ts`; it gets a dedicated `postgres()` connection.

- [ ] **Step 1: Install Better Auth**

Run: `pnpm add better-auth`

- [ ] **Step 2: Generate and adapt Better Auth's schema**

Run: `pnpm dlx @better-auth/cli generate --config lib/auth/server.ts --output lib/auth/schema.ts` (this is run again after Step 3 defines `server.ts`; for now hand-write the schema shape Better Auth's Drizzle adapter expects for email/password + OAuth, extended with `role`):

```ts
// lib/auth/schema.ts
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const roleEnum = ["agent", "admin"] as const;

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").$type<(typeof roleEnum)[number]>().notNull().default("agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

Use the `better-auth-best-practices` and `create-auth` skills here to verify this table shape and the adapter wiring in Step 3 match the installed Better Auth version's expectations before moving on — Better Auth's generated schema is the source of truth if it disagrees with the hand-written version above.

- [ ] **Step 3: Configure the Better Auth server instance**

```ts
// lib/auth/server.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const queryClient = postgres(process.env.DATABASE_URL!);
const authDb = drizzle(queryClient, { schema });

export const auth = betterAuth({
  database: drizzleAdapter(authDb, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "agent",
        input: false,
      },
    },
  },
});
```

- [ ] **Step 4: Add the client hooks**

```ts
// lib/auth/client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 5: Mount the route handler**

```ts
// app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth/server";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 6: Generate and run the migration for both schemas**

Run: `pnpm dlx drizzle-kit generate`
Run: `pnpm dlx drizzle-kit migrate`
Expected: migration files created under `./drizzle`, applied without error against the running `postgres` container from Task 1.

- [ ] **Step 7: Write an integration test against the local database**

```ts
// lib/auth/server.test.ts
import { describe, expect, it } from "vitest";
import { auth } from "./server";

describe("auth server", () => {
  it("creates a user with the default agent role on sign-up", async () => {
    const email = `test-${crypto.randomUUID()}@example.com`;
    const result = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Test Agent" },
    });

    expect(result.user.email).toBe(email);
    expect((result.user as { role: string }).role).toBe("agent");
  });
});
```

- [ ] **Step 8: Run it**

Run: `pnpm test lib/auth/server.test.ts`
Expected: PASS — requires the Postgres container from Task 1 running and migrations from Step 6 applied.

- [ ] **Step 9: Commit (Tasks 2 and 3 together)**

```bash
git add drizzle.config.ts lib/db lib/auth app/api/auth drizzle package.json pnpm-lock.yaml
git commit -m "Add Drizzle domain schema and Better Auth with role support"
```

---

### Task 4: Middleware protecting the dashboard

**Files:**
- Create: `middleware.ts`
- Create: `middleware.test.ts`

**Interfaces:**
- Consumes: `auth` from `lib/auth/server.ts` (Task 3).
- Produces: nothing consumed by later tasks directly — this is a terminal enforcement point.

- [ ] **Step 1: Write the failing test**

```ts
// middleware.test.ts
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { auth } from "@/lib/auth/server";
import { middleware } from "./middleware";

describe("dashboard middleware", () => {
  it("redirects to /login when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

    const response = await middleware(
      new NextRequest("http://localhost:3000/dashboard")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("passes through when a session exists", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "1", role: "agent" },
    } as never);

    const response = await middleware(
      new NextRequest("http://localhost:3000/dashboard")
    );

    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test middleware.test.ts`
Expected: FAIL — `middleware.ts` does not exist yet.

- [ ] **Step 3: Write the middleware**

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

export async function middleware(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test middleware.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add middleware.ts middleware.test.ts
git commit -m "Protect dashboard routes with session-checking middleware"
```

---

### Task 5: Logo component

**Files:**
- Create: `components/branding/logo.tsx`
- Test: `components/branding/logo.test.tsx`

**Interfaces:**
- Produces: `Logo` component, props `{ size?: "sm" | "md" | "lg" }`, default `"md"`. Consumed by Task 6 (login page) and Task 7 (dashboard nav).

- [ ] **Step 1: Write the failing test**

```tsx
// components/branding/logo.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo } from "./logo";

describe("Logo", () => {
  it("renders the app name", () => {
    render(<Logo />);
    expect(screen.getByText("Support Hub")).toBeInTheDocument();
  });

  it("applies a larger text size for the lg variant", () => {
    render(<Logo size="lg" />);
    expect(screen.getByText("Support Hub")).toHaveClass("text-2xl");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test components/branding/logo.test.tsx`
Expected: FAIL — `logo.tsx` does not exist yet.

- [ ] **Step 3: Write the component**

```tsx
// components/branding/logo.tsx
import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
} as const;

export function Logo({ size = "md" }: { size?: keyof typeof sizeClasses }) {
  return (
    <span className={cn("font-heading font-semibold tracking-tight", sizeClasses[size])}>
      Support Hub
    </span>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test components/branding/logo.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/branding
git commit -m "Add shared Logo component"
```

---

### Task 6: Login page

**Files:**
- Create: `app/login/page.tsx`
- Create: `e2e/login.spec.ts`

**Interfaces:**
- Consumes: `Logo` (Task 5), `signIn` from `lib/auth/client.ts` (Task 3), shadcn `Button`, `Input`, `Label`, `Card` (already present under `components/ui`).
- Produces: nothing consumed by later tasks — this is a leaf page.

- [ ] **Step 1: Write the login page**

```tsx
// app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/branding/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { signIn } from "@/lib/auth/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const result = await signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? "Unable to sign in.");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex justify-center pb-2">
          <Logo size="lg" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-col gap-4" onSubmit={handleEmailSignIn}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit">Sign in</Button>
          </form>
          <Button
            type="button"
            variant="outline"
            onClick={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })}
          >
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Write the E2E test**

Requires a seeded test user; run once against the dev database before the test (documented in the test file itself so it's runnable from a fresh checkout).

```ts
// e2e/login.spec.ts
import { test, expect } from "@playwright/test";
import { auth } from "@/lib/auth/server";

const email = "e2e-agent@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async () => {
  await auth.api.signUpEmail({ body: { email, password, name: "E2E Agent" } }).catch(() => {
    // Already exists from a previous run — sign-in is what this test verifies anyway.
  });
});

test("signs in with email and password and reaches the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/dashboard");
});

test("redirects unauthenticated visitors away from the dashboard", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 3: Run the E2E tests**

Run: `pnpm test:e2e e2e/login.spec.ts`
Expected: PASS (2 tests) — requires Postgres up and migrations applied.

- [ ] **Step 4: Commit**

```bash
git add app/login e2e/login.spec.ts
git commit -m "Add login page with email/password and Google sign-in"
```

---

### Task 7: Role-aware dashboard shell

**Files:**
- Create: `components/dashboard/nav.tsx`
- Create: `components/dashboard/nav.test.tsx`
- Create: `app/dashboard/layout.tsx`
- Create: `app/dashboard/page.tsx`
- Create: `e2e/dashboard-nav.spec.ts`

**Interfaces:**
- Consumes: `Logo` (Task 5), `useSession` from `lib/auth/client.ts` (Task 3).
- Produces: `Nav` component, prop `{ role: "agent" | "admin" }` — no later task in this plan consumes it, but the Ticket Ingestion and Knowledge Base phases will add links here.

- [ ] **Step 1: Write the failing test**

```tsx
// components/dashboard/nav.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nav } from "./nav";

describe("Nav", () => {
  it("shows Tickets for an agent but not Knowledge Base or Analytics", () => {
    render(<Nav role="agent" />);
    expect(screen.getByRole("link", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Knowledge Base" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
  });

  it("shows every link for an admin", () => {
    render(<Nav role="admin" />);
    expect(screen.getByRole("link", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge Base" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test components/dashboard/nav.test.tsx`
Expected: FAIL — `nav.tsx` does not exist yet.

- [ ] **Step 3: Write the nav component**

```tsx
// components/dashboard/nav.tsx
import Link from "next/link";

const agentLinks = [{ href: "/dashboard/tickets", label: "Tickets" }];
const adminOnlyLinks = [
  { href: "/dashboard/knowledge-base", label: "Knowledge Base" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/settings/prompts", label: "Prompt Settings" },
];

export function Nav({ role }: { role: "agent" | "admin" }) {
  const links = role === "admin" ? [...agentLinks, ...adminOnlyLinks] : agentLinks;

  return (
    <nav className="flex flex-col gap-1">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="rounded-md px-3 py-2 text-sm hover:bg-accent">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test components/dashboard/nav.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the dashboard layout and placeholder page**

```tsx
// app/dashboard/layout.tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { Logo } from "@/components/branding/logo";
import { Nav } from "@/components/dashboard/nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const role = (session.user as { role: "agent" | "admin" }).role;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r p-4">
        <div className="pb-6">
          <Logo />
        </div>
        <Nav role={role} />
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

```tsx
// app/dashboard/page.tsx
export default function DashboardPage() {
  return <p className="text-sm text-muted-foreground">Select a section from the sidebar.</p>;
}
```

- [ ] **Step 6: Write the E2E test for role-based nav**

```ts
// e2e/dashboard-nav.spec.ts
import { test, expect } from "@playwright/test";
import { auth } from "@/lib/auth/server";

test("an admin sees the admin-only links", async ({ page }) => {
  const email = "e2e-admin@example.com";
  const password = "correct-horse-battery-staple";

  await auth.api
    .signUpEmail({ body: { email, password, name: "E2E Admin" } })
    .catch(() => {});
  // Promote to admin directly — there is no UI for this yet, by design
  // (admin promotion tooling is out of scope for Foundation).
  await auth.api.updateUser({
    headers: {},
    body: { role: "admin" },
    // NOTE: replace with the project's actual admin-update path once
    // Better Auth's role-update API is confirmed against the installed
    // version during implementation (see better-auth-best-practices skill).
  } as never);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Knowledge Base" })).toBeVisible();
});
```

- [ ] **Step 7: Run the E2E test**

Run: `pnpm test:e2e e2e/dashboard-nav.spec.ts`
Expected: PASS — if Better Auth's role-update call in Step 6 doesn't match the installed version's API, fix the call using the `better-auth-best-practices` skill before treating this as passing; do not weaken the assertion.

- [ ] **Step 8: Commit**

```bash
git add components/dashboard app/dashboard e2e/dashboard-nav.spec.ts
git commit -m "Add role-aware dashboard shell"
```

---

### Task 8: Admin-only prompt template settings

**Files:**
- Create: `lib/prompt-templates.ts`
- Create: `lib/prompt-templates.test.ts`
- Create: `app/dashboard/settings/prompts/actions.ts`
- Create: `app/dashboard/settings/prompts/page.tsx`
- Create: `e2e/prompt-settings.spec.ts`

**Interfaces:**
- Consumes: `db`, `promptTemplates` (Task 2); `auth` (Task 3).
- Produces: `activateNewPromptVersion(key: string, content: string, updatedByUserId: string): Promise<void>`, `getActivePromptTemplate(key: string): Promise<{ content: string; version: number } | null>` — the AI Response Pipeline phase will call `getActivePromptTemplate` to fetch the draft-generation prompt.

- [ ] **Step 1: Write the failing unit test**

This test exercises the versioning logic against the real database (it is inherently a data-mutation operation, not a pure function) using a unique `key` per test run to avoid cross-test interference.

```ts
// lib/prompt-templates.test.ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { promptTemplates } from "@/lib/db/schema";
import { activateNewPromptVersion, getActivePromptTemplate } from "./prompt-templates";

describe("prompt template versioning", () => {
  it("deactivates the previous version when a new one is activated", async () => {
    const key = `test-prompt-${crypto.randomUUID()}`;
    const userId = "seed-user-id";

    await activateNewPromptVersion(key, "version one", userId);
    await activateNewPromptVersion(key, "version two", userId);

    const rows = await db.select().from(promptTemplates).where(eq(promptTemplates.key, key));
    const active = rows.filter((row) => row.isActive);

    expect(active).toHaveLength(1);
    expect(active[0].content).toBe("version two");
    expect(active[0].version).toBe(2);
  });

  it("returns the active version's content", async () => {
    const key = `test-prompt-${crypto.randomUUID()}`;
    await activateNewPromptVersion(key, "the content", "seed-user-id");

    const result = await getActivePromptTemplate(key);

    expect(result).toEqual({ content: "the content", version: 1 });
  });
});
```

`seed-user-id` must reference a real row for the foreign key to succeed — before running, seed one via the Task 3 sign-up flow, or relax `promptTemplates.updatedByUserId` foreign key enforcement is not an option (data integrity matters here); instead have the test create its own user:

```ts
// add above the two `it` blocks, inside the describe, as a shared `beforeAll`
import { auth } from "@/lib/auth/server";

let userId: string;

beforeAll(async () => {
  const result = await auth.api.signUpEmail({
    body: { email: `prompt-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
  });
  userId = result.user.id;
});
```

Replace both `"seed-user-id"` occurrences above with `userId`, and import `beforeAll` from `vitest`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test lib/prompt-templates.test.ts`
Expected: FAIL — `lib/prompt-templates.ts` does not exist yet.

- [ ] **Step 3: Implement the versioning logic**

```ts
// lib/prompt-templates.ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { promptTemplates } from "@/lib/db/schema";

export async function activateNewPromptVersion(
  key: string,
  content: string,
  updatedByUserId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ version: promptTemplates.version })
      .from(promptTemplates)
      .where(eq(promptTemplates.key, key))
      .orderBy(desc(promptTemplates.version))
      .limit(1);

    await tx
      .update(promptTemplates)
      .set({ isActive: false })
      .where(and(eq(promptTemplates.key, key), eq(promptTemplates.isActive, true)));

    await tx.insert(promptTemplates).values({
      key,
      content,
      version: (previous?.version ?? 0) + 1,
      isActive: true,
      updatedByUserId,
    });
  });
}

export async function getActivePromptTemplate(
  key: string
): Promise<{ content: string; version: number } | null> {
  const [row] = await db
    .select({ content: promptTemplates.content, version: promptTemplates.version })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.key, key), eq(promptTemplates.isActive, true)))
    .limit(1);

  return row ?? null;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test lib/prompt-templates.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the server action and the admin page**

```ts
// app/dashboard/settings/prompts/actions.ts
"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { activateNewPromptVersion } from "@/lib/prompt-templates";

export async function savePromptTemplate(key: string, content: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    throw new Error("Only admins can edit prompt templates.");
  }

  await activateNewPromptVersion(key, content, session.user.id);
}
```

```tsx
// app/dashboard/settings/prompts/page.tsx
import { getActivePromptTemplate } from "@/lib/prompt-templates";
import { PromptEditorForm } from "./prompt-editor-form";

const DRAFT_REPLY_PROMPT_KEY = "draft_reply_system";

export default async function PromptSettingsPage() {
  const active = await getActivePromptTemplate(DRAFT_REPLY_PROMPT_KEY);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Draft Reply Prompt</h1>
      <PromptEditorForm
        promptKey={DRAFT_REPLY_PROMPT_KEY}
        initialContent={active?.content ?? ""}
        currentVersion={active?.version ?? 0}
      />
    </div>
  );
}
```

```tsx
// app/dashboard/settings/prompts/prompt-editor-form.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { savePromptTemplate } from "./actions";

export function PromptEditorForm({
  promptKey,
  initialContent,
  currentVersion,
}: {
  promptKey: string;
  initialContent: string;
  currentVersion: number;
}) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(currentVersion);

  async function handleSave() {
    setSaving(true);
    await savePromptTemplate(promptKey, content);
    setSavedVersion((version) => version + 1);
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={12}
      />
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <span className="text-sm text-muted-foreground">Active version: {savedVersion}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the E2E test for admin-only access**

```ts
// e2e/prompt-settings.spec.ts
import { test, expect } from "@playwright/test";

test("an agent cannot see the prompt settings link", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e-agent@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Prompt Settings" })).not.toBeVisible();
});

test("an admin can edit and save the draft reply prompt", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e-admin@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Prompt Settings" }).click();
  await page.getByRole("textbox").fill("Updated system prompt content.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(/Active version: \d+/)).toBeVisible();
});
```

- [ ] **Step 7: Run the E2E tests**

Run: `pnpm test:e2e e2e/prompt-settings.spec.ts`
Expected: PASS — depends on the admin/agent test users created in Task 6/7's E2E specs already existing.

- [ ] **Step 8: Commit**

```bash
git add lib/prompt-templates.ts lib/prompt-templates.test.ts app/dashboard/settings e2e/prompt-settings.spec.ts
git commit -m "Add admin-only prompt template versioning and settings page"
```

---

## Spec Coverage Check

- Docker/Postgres/pgvector local dev: Task 1.
- Drizzle schema (all core tables, including reserved LangGraph column): Task 2.
- Better Auth (email/password, Google OAuth, role field): Task 3.
- Dashboard route protection: Task 4.
- Branding/Logo component: Task 5.
- Login page: Task 6.
- Role-aware nav/dashboard shell: Task 7.
- Admin-editable prompt templates (versioned): Task 8.
- Testing stack (Vitest + Playwright) used throughout: Tasks 1–8.
- Mailbox connection table exists (Task 2); its OAuth flow and UI are explicitly out of scope per the spec and are not built here.
