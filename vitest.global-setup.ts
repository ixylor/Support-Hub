// Runs once before the whole suite (vitest.config.mts sets
// fileParallelism: false, so a single reset up front is sufficient — no
// test file runs before this finishes, and none run concurrently with it).
// This is what makes the unit tests self-cleaning: every run starts against
// an empty, migrated test database instead of relying on each test file to
// remember to delete what it created.
import { spawnSync } from "node:child_process";

export default function globalSetup() {
  const result = spawnSync("node", ["scripts/reset-test-db.mjs"], {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error("Failed to reset the test database before running tests.");
  }
}
