// Applies the Drizzle migrations to the isolated test database instead of
// the dev one. drizzle.config.ts reads its connection string from
// DATABASE_URL, so this overrides that var only for the spawned drizzle-kit
// process — the parent process (and everything else) keeps the real value.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("TEST_DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

if (testDatabaseUrl === process.env.DATABASE_URL) {
  console.error(
    "TEST_DATABASE_URL is the same as DATABASE_URL — refusing to run migrations " +
      "against what looks like the dev database."
  );
  process.exit(1);
}

const result = spawnSync("drizzle-kit", ["migrate"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
});

process.exit(result.status ?? 1);
