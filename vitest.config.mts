import "dotenv/config";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is not set — see .env.example.");
}

if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is the same as DATABASE_URL — refusing to run tests " +
      "against what looks like the dev database."
  );
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules", "dist", ".next", "e2e"],
    // Injected into each test worker's process.env, overriding whatever
    // DATABASE_URL .env sets — this is what points lib/db/client.ts at the
    // test database instead of the dev one for every test file.
    env: {
      DATABASE_URL: testDatabaseUrl,
    },
    // mailbox_connections enforces a single active row across the whole
    // database (see mailbox_connections_one_active); running test files in
    // parallel against the shared test DB would let them race for that row.
    fileParallelism: false,
  },
});
