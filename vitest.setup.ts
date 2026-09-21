import "dotenv/config";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

afterEach(() => {
  cleanup();
});

// scripts/reset-test-db.mjs truncates every other table once per `pnpm test`
// invocation, but deliberately preserves `agents` and `agent_prompt_versions`
// — they're seeded by migration 0006, not by application code, so there's no
// app-code seed step for that script to re-run. That means these two tables
// are the one piece of state that survives from file to file within a single
// run: if an earlier file activates a new prompt version, disables an agent,
// or pins a deployment, every later file in that run would otherwise see
// that mutation instead of a clean catalog. Re-normalize them before each
// file's tests run, so every file starts from the same known baseline
// regardless of what an earlier file left behind. temperature is
// deliberately left alone — per-agent defaults differ and later tasks' tests
// manage it themselves.
beforeAll(async () => {
  await db.execute(sql`DELETE FROM "agent_prompt_versions" WHERE "version" > 1`);
  await db.execute(sql`
    UPDATE "agent_prompt_versions"
    SET "is_active" = true, "updated_by_user_id" = NULL
    WHERE "version" = 1
  `);
  await db.execute(sql`UPDATE "agents" SET "ai_deployment_id" = NULL, "is_enabled" = true`);
});
