// Runs once before the whole suite (vitest.config.mts sets
// fileParallelism: false, so a single reset up front is sufficient — no
// test file runs before this finishes, and none run concurrently with it).
// This is what makes the unit tests self-cleaning: every run starts against
// an empty, migrated test database instead of relying on each test file to
// remember to delete what it created.
import { spawnSync } from "node:child_process";

export default function globalSetup() {
  const resetResult = spawnSync("node", ["scripts/reset-test-db.mjs"], {
    stdio: "inherit",
    shell: true,
  });

  if (resetResult.status !== 0) {
    throw new Error("Failed to reset the test database before running tests.");
  }

  // Runs after the truncate, not merged into it — reset-test-db.mjs's one
  // job is truncation, and the checkpointer's tables are not among the
  // ones it manages. PostgresSaver.setup() is idempotent, so running it on
  // every invocation is cheap and keeps lib/workflow/graph.test.ts's real
  // checkpointer usable without a separate manual setup step.
  const checkpointerResult = spawnSync("node", ["scripts/setup-checkpointer-test.mjs"], {
    stdio: "inherit",
    shell: true,
  });

  if (checkpointerResult.status !== 0) {
    throw new Error("Failed to set up the checkpointer tables before running tests.");
  }
}
