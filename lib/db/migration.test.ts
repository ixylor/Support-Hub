import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

// Runs migrations' actual effect against the live Postgres instance the other
// integration tests use (see .env / docker-compose.yml), rather than an
// in-memory schema object — schema.test.ts checks shape, this checks that the
// migrations were actually applied and produced a matching database (this is
// what would have caught the missing `pgvector` extension on a fresh checkout).
describe("migration smoke test", () => {
  const expectedTables = [
    "app_secrets",
    "attachments",
    "kb_chunks",
    "kb_entries",
    "llm_logs",
    "mailbox_connections",
    "prompt_templates",
    "ticket_ai_drafts",
    "ticket_messages",
    "tickets",
    "user",
    "session",
    "account",
    "verification",
  ];

  const expectedEnums = [
    "mailbox_provider",
    "mailbox_status",
    "message_direction",
    "ticket_category",
    "ticket_priority",
    "ticket_status",
  ];

  it("creates the pgvector extension", async () => {
    const rows = await db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`
    );

    expect(rows.length).toBe(1);
  });

  it("creates every domain and auth table", async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const tableNames = rows.map((row) => row.table_name);

    for (const table of expectedTables) {
      expect(tableNames).toContain(table);
    }
  });

  it("creates every domain enum type", async () => {
    const rows = await db.execute<{ typname: string }>(
      sql`SELECT typname FROM pg_type WHERE typtype = 'e'`
    );
    const enumNames = rows.map((row) => row.typname);

    for (const enumName of expectedEnums) {
      expect(enumNames).toContain(enumName);
    }
  });

  it("creates the kb_chunks embedding column as a vector", async () => {
    const rows = await db.execute<{ data_type: string; udt_name: string }>(
      sql`SELECT data_type, udt_name FROM information_schema.columns
          WHERE table_name = 'kb_chunks' AND column_name = 'embedding'`
    );

    expect(rows[0]?.udt_name).toBe("vector");
  });

  it("creates the user table's role CHECK constraint", async () => {
    const rows = await db.execute<{ conname: string }>(
      sql`SELECT conname FROM pg_constraint WHERE conname = 'role_check'`
    );

    expect(rows.length).toBe(1);
  });

  it("adds google to the mailbox_provider enum", async () => {
    const rows = await db.execute<{ enumlabel: string }>(
      sql`SELECT enumlabel FROM pg_enum
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
        WHERE pg_type.typname = 'mailbox_provider'`
    );

    expect(rows.map((row) => row.enumlabel)).toEqual(expect.arrayContaining(["microsoft", "google"]));
  });

  it("enforces at most one active mailbox connection", async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE indexname = 'mailbox_connections_one_active'`
    );

    expect(rows.length).toBe(1);
  });
});
