import type { FullConfig } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

// Every account the spec files sign in with, created once here before any
// test worker starts.
//
// Each spec still signs its own accounts up in a beforeAll, which is enough
// when the accounts already exist but is not race-safe against an empty
// database: the unit suite's global setup truncates the test database, and
// several workers then reach better-auth's "does this email exist" check
// before any of their writes land. Seeding sequentially in this single
// process, before any worker exists, removes the race without the spec
// files needing to know about each other.
//
// The spec-level sign-ups are deliberately left in place — they make a
// single spec runnable on its own, which is how these get debugged.
const PASSWORD = "correct-horse-battery-staple";

const AGENT_EMAILS = [
  "e2e-agent@example.com",
  "e2e-integrations-agent@example.com",
  "e2e-kb-agent@example.com",
  "e2e-tickets-agent@example.com",
  "e2e-tickets-other-agent@example.com",
  "e2e-agents-agent@example.com",
];

const ADMIN_EMAILS = [
  "e2e-admin@example.com",
  "e2e-integrations-admin@example.com",
  "e2e-kb-admin@example.com",
  "e2e-tickets-admin@example.com",
  "e2e-agents-admin@example.com",
  "e2e-email-admin@example.com",
];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) {
    throw new Error("No baseURL configured — cannot seed end-to-end accounts.");
  }

  // Sign up over HTTP rather than importing lib/auth/server: that module reads
  // secrets via a top-level await, which Playwright's transform cannot execute
  // in a file it loads directly. Same reasoning as the spec files' own helpers.
  for (const email of [...AGENT_EMAILS, ...ADMIN_EMAILS]) {
    await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseURL },
      body: JSON.stringify({ email, password: PASSWORD, name: email }),
    }).catch(() => {
      // Already present from an earlier run against a database that was not
      // reset. The role update below still runs, so the account ends up in the
      // state the specs expect either way.
    });
  }

  await db.update(user).set({ role: "admin" }).where(inArray(user.email, ADMIN_EMAILS));
}
