// Truncates every table in the test database's public schema back to an
// empty, still-migrated state. This is what actually fixes unit-test-user
// pollution: instead of every test file having to remember to clean up the
// rows it created (fiddly bookkeeping that has already gone wrong once),
// the suite starts from a known-empty database every run.
//
// Modeled on scripts/migrate-test.mjs, which established the pattern of
// reading TEST_DATABASE_URL and refusing to run against DATABASE_URL. This
// script is destructive (TRUNCATE, not a dry-run), so its guard is stricter
// in two ways an unnormalized string comparison and a naming convention
// alone don't cover:
//
//   1. Two connection strings that differ only cosmetically (trailing
//      slash, sslmode or other query params, userinfo, localhost vs.
//      127.0.0.1 vs. ::1, an absent port vs. the default) can still point
//      at the *same physical database*. assertSafeToReset parses both URLs
//      and compares normalized identity — host, port, database name — not
//      the raw strings.
//   2. A database-name check alone can be fooled if the shared database's
//      name happens to satisfy it (e.g. a staging instance named
//      "acme_test" that both the app and the harness point at). After
//      connecting, verifyLiveDatabaseIsDisposable asks the server itself
//      what database it's in (`select current_database()`) and confirms
//      that against the same naming rule before any destructive statement
//      runs — closing the gap between what a URL parses to and what the
//      server actually resolves to.
//
// assertSafeToReset is a pure function (no I/O) so it can be unit tested
// without a database — see scripts/reset-test-db.test.ts.
import { pathToFileURL } from "node:url";

/**
 * Parses a Postgres connection string into the identity that actually
 * determines which physical database it points at: host, port and
 * database name. Userinfo (username/password) and query parameters
 * (sslmode, etc.) are deliberately ignored — neither changes which
 * database a connection lands in. Loopback hostnames are normalized to a
 * single form so "localhost", "127.0.0.1" and "::1" compare equal.
 */
export function normalizeDbIdentity(rawUrl) {
  const url = new URL(rawUrl);

  let host = url.hostname.toLowerCase();
  if (host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    host = "localhost";
  }

  const port = url.port ? Number(url.port) : 5432;

  // Strip the leading slash and any trailing slash, so "/db" and "/db/"
  // (and the empty-segment pathname a trailing slash produces) agree.
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, "").replace(/\/+$/, ""));

  return { host, port, database };
}

/**
 * Throws with a message naming exactly what was compared and why, unless
 * testUrlRaw is confirmed safe to truncate against devUrlRaw. Returns the
 * normalized identity of testUrlRaw on success, so callers can reuse it
 * (e.g. to verify the live connection matches).
 */
export function assertSafeToReset(testUrlRaw, devUrlRaw) {
  const testUrl = typeof testUrlRaw === "string" ? testUrlRaw.trim() : "";
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is not set — see .env.example.");
  }

  let testIdentity;
  try {
    testIdentity = normalizeDbIdentity(testUrl);
  } catch {
    throw new Error(
      `TEST_DATABASE_URL ("${testUrl}") is not a valid connection string — see .env.example.`
    );
  }

  const devUrl = typeof devUrlRaw === "string" ? devUrlRaw.trim() : "";
  if (devUrl) {
    let devIdentity = null;
    try {
      devIdentity = normalizeDbIdentity(devUrl);
    } catch {
      // DATABASE_URL is malformed — nothing meaningful to compare against,
      // so fall through to the naming check below rather than blocking on
      // a value we can't parse.
    }

    if (
      devIdentity &&
      devIdentity.host === testIdentity.host &&
      devIdentity.port === testIdentity.port &&
      devIdentity.database === testIdentity.database
    ) {
      throw new Error(
        "TEST_DATABASE_URL resolves to the same database as DATABASE_URL " +
          `(host=${testIdentity.host} port=${testIdentity.port} database=${testIdentity.database}) — ` +
          "refusing to reset what looks like the dev database."
      );
    }
  }

  if (!/test/i.test(testIdentity.database)) {
    throw new Error(
      `TEST_DATABASE_URL's database name ("${testIdentity.database}") doesn't contain "test" — ` +
        "refusing to truncate a database that doesn't look disposable."
    );
  }

  return testIdentity;
}

// Maps pg_constraint's single-character action codes to the SQL keywords
// ALTER TABLE ... ADD CONSTRAINT expects, so a captured FK can be recreated
// with the same ON DELETE/ON UPDATE behavior it actually had — see
// findForeignKey below.
const FK_ACTION_KEYWORDS = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

/**
 * Looks up the single-column foreign key constraint on `table.column`,
 * reading it from pg_constraint rather than assuming a name: drizzle-kit
 * derives constraint names from table/column names, so if a later migration
 * renames either side, the name this script would otherwise hardcode goes
 * stale silently (DROP CONSTRAINT IF EXISTS no-ops, the later ADD CONSTRAINT
 * hard-fails). Reading the constraint that's actually there — including its
 * referenced table/column and its ON DELETE/ON UPDATE actions — means this
 * script tracks whatever the schema says instead of duplicating it.
 * Throws if no such constraint exists, since a caller that expects one to be
 * there and finds none should fail loudly, not leave the database silently
 * wrong.
 */
async function findForeignKey(sql, tableName, columnName) {
  const [row] = await sql`
    SELECT
      con.conname AS constraint_name,
      ref_table.relname AS referenced_table,
      ref_col.attname AS referenced_column,
      con.confdeltype AS on_delete,
      con.confupdtype AS on_update
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = ANY(con.conkey)
    JOIN pg_class ref_table ON ref_table.oid = con.confrelid
    JOIN pg_attribute ref_col ON ref_col.attrelid = ref_table.oid AND ref_col.attnum = ANY(con.confkey)
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND tbl.relname = ${tableName}
      AND col.attname = ${columnName}
  `;

  if (!row) {
    throw new Error(
      `Expected a foreign key on "${tableName}"."${columnName}" but found none — ` +
        "the schema may have changed without this script being updated."
    );
  }

  return {
    constraintName: row.constraint_name,
    referencedTable: row.referenced_table,
    referencedColumn: row.referenced_column,
    onDelete: FK_ACTION_KEYWORDS[row.on_delete] ?? "NO ACTION",
    onUpdate: FK_ACTION_KEYWORDS[row.on_update] ?? "NO ACTION",
  };
}

/**
 * Confirms, using the live connection itself rather than the URL we parsed
 * it from, that we are actually in a database whose name looks disposable.
 * This is the second layer: it catches the case where a connection string
 * resolves (through DNS, a proxy, a forwarded port, or a server alias)
 * to a different database than its URL suggested.
 */
export async function verifyLiveDatabaseIsDisposable(sql, expectedIdentity) {
  const [row] = await sql`select current_database() as db_name`;
  const liveName = row.db_name;

  if (!/test/i.test(liveName)) {
    throw new Error(
      `Connected database "${liveName}" doesn't contain "test" in its name — refusing to truncate it.`
    );
  }

  if (liveName !== expectedIdentity.database) {
    throw new Error(
      `Connected database "${liveName}" doesn't match the database name in TEST_DATABASE_URL ` +
        `("${expectedIdentity.database}") — refusing to truncate.`
    );
  }
}

async function main() {
  await import("dotenv/config");
  const postgres = (await import("postgres")).default;

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const databaseUrl = process.env.DATABASE_URL;

  let testIdentity;
  try {
    testIdentity = assertSafeToReset(testDatabaseUrl, databaseUrl);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const sql = postgres(testDatabaseUrl.trim());

  try {
    await verifyLiveDatabaseIsDisposable(sql, testIdentity);

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;

    // agents and agent_prompt_versions are seeded by migration 0006, not by
    // application code, which is why they are preserved here rather than
    // truncated and re-created: there's no app-code seed step to re-run them
    // from. (Per-file normalization of these rows — reactivating version 1,
    // clearing test mutations — lives in vitest.setup.ts, not here: this
    // script only runs once per `pnpm test` invocation, but a test file
    // mutating a shared row needs the next test *file* to see a clean
    // baseline too, not just the next full suite run.)
    //
    // Excluding them from the table list below isn't enough on its own:
    // Postgres's TRUNCATE ... CASCADE truncates every table with an FK to a
    // truncated table based on the constraint's existence, not on whether
    // any row currently references it. "user" has to be truncated (real
    // per-test rows), and both ai_deployments.updated_by_user_id and
    // agent_prompt_versions.updated_by_user_id reference "user" directly,
    // while agents.ai_deployment_id references ai_deployments — so
    // truncating "user" would cascade straight into agent_prompt_versions,
    // and separately through ai_deployments into agents (and from there,
    // via agent_prompt_versions' own ON DELETE CASCADE, into
    // agent_prompt_versions again), regardless of any exclusion list.
    // Dropping both FKs for the duration of the truncate severs those
    // chains; they're recreated immediately after (using whatever
    // findForeignKey actually found, not a hardcoded name), once the
    // columns they constrain have been nulled so the recreated constraints
    // have nothing to validate against a row TRUNCATE is about to remove.
    const hasAgentsCatalog = tables.some((t) => t.table_name === "agents");
    const excludedFromTruncate = hasAgentsCatalog ? ["agents", "agent_prompt_versions"] : [];

    let agentsAiDeploymentFk;
    let agentPromptVersionsUpdatedByFk;

    if (hasAgentsCatalog) {
      agentsAiDeploymentFk = await findForeignKey(sql, "agents", "ai_deployment_id");
      agentPromptVersionsUpdatedByFk = await findForeignKey(
        sql,
        "agent_prompt_versions",
        "updated_by_user_id"
      );

      await sql.unsafe(
        `ALTER TABLE "agents" DROP CONSTRAINT "${agentsAiDeploymentFk.constraintName}"`
      );
      await sql.unsafe(
        `ALTER TABLE "agent_prompt_versions" DROP CONSTRAINT "${agentPromptVersionsUpdatedByFk.constraintName}"`
      );
      await sql`UPDATE "agents" SET "ai_deployment_id" = NULL`;
      await sql`UPDATE "agent_prompt_versions" SET "updated_by_user_id" = NULL`;
    }

    const truncatable = tables.filter((t) => !excludedFromTruncate.includes(t.table_name));

    if (truncatable.length === 0) {
      console.log("No tables found in the public schema — nothing to reset.");
    } else {
      // One statement, not per-table deletes in dependency order: TRUNCATE
      // ... CASCADE handles every foreign key between these tables at once,
      // which is the whole reason deleting user rows kept breaking (deletes
      // must be ordered by hand; a single TRUNCATE CASCADE doesn't need to
      // be). This never touches the drizzle schema's migration history table
      // or the pgboss schema (see note below), so the database stays
      // migrated and pg-boss's own state is left alone.
      const tableList = truncatable.map((t) => `"public"."${t.table_name}"`).join(", ");
      await sql.unsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
      console.log(`Truncated ${truncatable.length} table(s) in the public schema of ${testIdentity.database}.`);
    }

    // Recreate both FKs from what findForeignKey actually captured — same
    // constraint name, referenced table/column and ON DELETE/ON UPDATE
    // actions the schema had before they were severed above — rather than
    // assuming NO ACTION or re-deriving a name. Row-level normalization
    // (reactivating version 1, re-enabling agents, etc.) happens per test
    // file in vitest.setup.ts, not here — see the comment above.
    if (hasAgentsCatalog) {
      await sql.unsafe(
        `ALTER TABLE "agents" ADD CONSTRAINT "${agentsAiDeploymentFk.constraintName}" ` +
          `FOREIGN KEY ("ai_deployment_id") REFERENCES "${agentsAiDeploymentFk.referencedTable}"("${agentsAiDeploymentFk.referencedColumn}") ` +
          `ON DELETE ${agentsAiDeploymentFk.onDelete} ON UPDATE ${agentsAiDeploymentFk.onUpdate}`
      );
      await sql.unsafe(
        `ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "${agentPromptVersionsUpdatedByFk.constraintName}" ` +
          `FOREIGN KEY ("updated_by_user_id") REFERENCES "${agentPromptVersionsUpdatedByFk.referencedTable}"("${agentPromptVersionsUpdatedByFk.referencedColumn}") ` +
          `ON DELETE ${agentPromptVersionsUpdatedByFk.onDelete} ON UPDATE ${agentPromptVersionsUpdatedByFk.onUpdate}`
      );
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
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

// Only run the destructive work when this file is executed directly (e.g.
// `node scripts/reset-test-db.mjs`), not when it's imported — the guard
// functions above are imported by scripts/reset-test-db.test.ts without a
// database, and importing this module must never have side effects.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
