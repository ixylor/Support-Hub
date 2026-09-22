// Creates the checkpointer's tables against the test database instead of the
// dev one. Same shape as scripts/migrate-test.mjs: DATABASE_URL is what
// lib/workflow/checkpointer.ts reads, so this overrides that var only for
// the spawned process, pointing setup-checkpointer.ts at TEST_DATABASE_URL
// without touching the parent process's real DATABASE_URL.
//
// Invoked from vitest.global-setup.ts, ahead of every test run, rather than
// left as a one-off setup step like db:migrate:test: PostgresSaver.setup()
// is idempotent (it no-ops once the tables exist), and graph.test.ts is the
// first place a real checkpointer is exercised against this database, so
// there is no earlier point where a human would remember to run this by
// hand.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("TEST_DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

if (testDatabaseUrl === process.env.DATABASE_URL) {
  console.error(
    "TEST_DATABASE_URL is the same as DATABASE_URL — refusing to set up the checkpointer " +
      "against what looks like the dev database."
  );
  process.exit(1);
}

const result = spawnSync("tsx", ["scripts/setup-checkpointer.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
});

process.exit(result.status ?? 1);
