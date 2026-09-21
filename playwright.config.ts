import "dotenv/config";
import { defineConfig } from "@playwright/test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is not set — see .env.example.");
}

// Playwright reloads this config in every worker process, and workers
// inherit the override below via process.env — so on the second load
// DATABASE_URL already equals testDatabaseUrl, which is the success case,
// not a misconfiguration. Only compare/override once per process tree, using
// a marker var that inherits alongside DATABASE_URL.
if (!process.env.SUPPORT_HUB_TEST_DB_APPLIED) {
  if (testDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is the same as DATABASE_URL — refusing to run tests " +
        "against what looks like the dev database."
    );
  }

  // Overriding process.env here (rather than only passing it via
  // webServer.env) points two things at the test database: the dev server
  // spawned below through `webServer.command`, which inherits this
  // process's env, and this config's own process, which is what spec files
  // run in when they import lib/db/client.ts directly (e.g. to promote a
  // user to admin). A dev server the developer starts by hand in another
  // terminal loads .env itself and never sees this override, so it keeps
  // using the dev database.
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.SUPPORT_HUB_TEST_DB_APPLIED = "1";
}

// A dedicated port, distinct from the developer's own `pnpm dev` (port
// 3000), so the two can run side by side. reuseExistingServer is false on
// purpose: if something is already bound to this port, that's a stale test
// run, not the developer's server — failing loudly beats silently testing
// against whatever that process happens to be connected to.
const testServerPort = 3100;
const testServerUrl = `http://localhost:${testServerPort}`;

export default defineConfig({
  testDir: "./e2e",
  webServer: [
    {
      name: "Next server",
      command: `pnpm dev -p ${testServerPort}`,
      url: testServerUrl,
      reuseExistingServer: false,
      // Explicit here (rather than relying solely on the process.env mutation
      // above) so the spawned server's database is visible directly in this
      // config, not just inferred from load order.
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        PORT: String(testServerPort),
        // Better Auth rejects requests whose origin isn't BETTER_AUTH_URL, so
        // this has to match the port above or every request gets an "Invalid
        // origin" error.
        BETTER_AUTH_URL: testServerUrl,
        // See next.config.ts — keeps this server's dev-server lockfile and
        // build output separate from the developer's own `pnpm dev`.
        NEXT_DIST_DIR: ".next-test",
      },
    },
    {
      // The knowledge base upload test needs a running worker to move a
      // document from pending to ready. It has no HTTP endpoint of its own,
      // so readiness is detected from its startup log line rather than a
      // port or URL.
      //
      // Deliberately not `pnpm worker`: pnpm's own shim plus the `tsx` CLI's
      // internal re-exec each add a layer of shell/process nesting, and on
      // this Windows setup those inner processes can outlive Playwright's
      // tree-kill of the outer shell, leaking a worker process that keeps
      // draining the queue after the suite exits. Running the loader
      // directly (the same thing the `tsx` CLI does internally) keeps this
      // to a single node process under the spawned shell, which Playwright's
      // teardown reliably kills.
      name: "Worker",
      command: "node --import tsx lib/jobs/worker.ts",
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
      },
      reuseExistingServer: false,
      stdout: "pipe",
      wait: { stdout: /Worker started\./ },
    },
  ],
  use: {
    baseURL: testServerUrl,
  },
});
