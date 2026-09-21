// Truncates every table in the test database's public schema back to an
// empty, still-migrated state. This is what actually fixes unit-test-user
// pollution: instead of every test file having to remember to clean up the
// rows it created (fiddly bookkeeping that has already gone wrong once),
// the suite starts from a known-empty database every run.
//
// Modeled on scripts/migrate-test.mjs, which established the pattern of
// reading TEST_DATABASE_URL and refusing to run against DATABASE_URL. This
// script is destructive (TRUNCATE, not a dry-run), so its guard is stricter:
// on top of the equality check, it also requires the database name to look
// like a test database before it will touch anything.
import "dotenv/config";
import postgres from "postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("TEST_DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

if (testDatabaseUrl === databaseUrl) {
  console.error(
    "TEST_DATABASE_URL is the same as DATABASE_URL — refusing to reset what looks " +
      "like the dev database."
  );
  process.exit(1);
}

// Extra guard beyond the migration script's: this command is destructive
// (TRUNCATE CASCADE across every table), so a typo that points it at the
// wrong database is far more costly than a typo pointing a migration there.
// Require the database name itself to look like a test database.
const testDbName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
if (!/test/i.test(testDbName)) {
  console.error(
    `TEST_DATABASE_URL's database name ("${testDbName}") doesn't contain "test" — ` +
      "refusing to truncate a database that doesn't look disposable."
  );
  process.exit(1);
}

const sql = postgres(testDatabaseUrl);

try {
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;

  if (tables.length === 0) {
    console.log("No tables found in the public schema — nothing to reset.");
  } else {
    // One statement, not per-table deletes in dependency order: TRUNCATE
    // ... CASCADE handles every foreign key between these tables at once,
    // which is the whole reason deleting user rows kept breaking (deletes
    // must be ordered by hand; a single TRUNCATE CASCADE doesn't need to
    // be). This never touches the drizzle schema's migration history table
    // or the pgboss schema (see note below), so the database stays
    // migrated and pg-boss's own state is left alone.
    const tableList = tables.map((t) => `"public"."${t.table_name}"`).join(", ");
    await sql.unsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    console.log(`Truncated ${tables.length} table(s) in the public schema of ${testDbName}.`);
  }

  // Deliberately NOT truncating the pgboss schema. pg-boss owns that schema
  // end to end — it tracks its own migration version in pgboss.version and
  // expects to manage job/queue state through its own API, not have rows
  // removed out from under it. Truncating job/queue/schedule tables
  // directly risks leaving pg-boss's internal bookkeeping (e.g. queue
  // definitions vs. job rows) in a state it never produces itself, which is
  // a worse failure mode than the stale-job flakiness this would guard
  // against. If a stale job from an interrupted run causes flakiness in
  // lib/jobs/queues.test.ts, the fix belongs in that test (clean up the
  // jobs it enqueues), not in a schema-wide reset owned by another library.
} finally {
  await sql.end();
}
