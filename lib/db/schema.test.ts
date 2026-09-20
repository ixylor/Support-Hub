import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  aiDeployments,
  appSecrets,
  kbChunks,
  kbEntries,
  mailboxConnections,
  promptTemplates,
  ticketAiDrafts,
  ticketMessages,
  tickets,
} from "./schema";
import { user } from "@/lib/auth/schema";

describe("domain schema", () => {
  it("exposes the columns the AI pipeline phase will rely on", () => {
    expect(Object.keys(ticketAiDrafts)).toEqual(
      expect.arrayContaining(["graphThreadId", "promptTemplateId", "confidenceScore"])
    );
  });

  it("exposes the columns the review dashboard will rely on", () => {
    expect(Object.keys(tickets)).toEqual(
      expect.arrayContaining(["status", "category", "priority"])
    );
  });

  it("supports versioned prompt templates", () => {
    expect(Object.keys(promptTemplates)).toEqual(
      expect.arrayContaining(["key", "version", "isActive"])
    );
  });

  it("stores OAuth credentials as an encrypted value, never plaintext", () => {
    expect(Object.keys(appSecrets)).toEqual(
      expect.arrayContaining(["key", "encryptedValue"])
    );
    expect(Object.keys(appSecrets)).not.toContain("value");
  });

  it("supports a per-provider sync checkpoint on the mailbox connection", () => {
    expect(Object.keys(mailboxConnections)).toEqual(
      expect.arrayContaining(["syncCursor"])
    );
  });

  it("threads tickets by mailbox connection and provider thread id", () => {
    expect(Object.keys(tickets)).toEqual(
      expect.arrayContaining(["mailboxConnectionId", "providerThreadId"])
    );
  });

  it("dedupes ingested messages by provider message id", () => {
    expect(Object.keys(ticketMessages)).toEqual(
      expect.arrayContaining(["providerMessageId"])
    );
  });
});

describe("ai_deployments", () => {
  async function createAdmin(): Promise<string> {
    const [row] = await db
      .insert(user)
      .values({
        id: `ai-deployments-test-${crypto.randomUUID()}`,
        name: "Schema Test Admin",
        email: `ai-deployments-test-${crypto.randomUUID()}@example.com`,
        role: "admin",
      })
      .returning({ id: user.id });
    return row.id;
  }

  afterEach(async () => {
    await db.delete(aiDeployments);
  });

  it("allows only one active deployment per role", async () => {
    const adminId = await createAdmin();

    await db.insert(aiDeployments).values({
      role: "embedding",
      deploymentName: "text-embedding-3-small",
      modelName: "text-embedding-3-small",
      dimensions: 1536,
      isActive: true,
      updatedByUserId: adminId,
    });

    await expect(
      db.insert(aiDeployments).values({
        role: "embedding",
        deploymentName: "text-embedding-3-large",
        modelName: "text-embedding-3-large",
        dimensions: 3072,
        isActive: true,
        updatedByUserId: adminId,
      })
    ).rejects.toThrow();
  });

  it("allows many inactive deployments for the same role", async () => {
    const adminId = await createAdmin();

    await db.insert(aiDeployments).values([
      {
        role: "chat",
        deploymentName: "gpt-4.1",
        modelName: "gpt-4.1",
        isActive: false,
        updatedByUserId: adminId,
      },
      {
        role: "chat",
        deploymentName: "gpt-4.1-mini",
        modelName: "gpt-4.1-mini",
        isActive: false,
        updatedByUserId: adminId,
      },
    ]);

    const rows = await db.select().from(aiDeployments);
    expect(rows).toHaveLength(2);
  });

  it("allows one active deployment in each distinct role", async () => {
    const adminId = await createAdmin();

    await db.insert(aiDeployments).values([
      { role: "chat", deploymentName: "gpt-4.1", modelName: "gpt-4.1", isActive: true, updatedByUserId: adminId },
      { role: "extraction", deploymentName: "gpt-4.1", modelName: "gpt-4.1", isActive: true, updatedByUserId: adminId },
    ]);

    const rows = await db.select().from(aiDeployments);
    expect(rows).toHaveLength(2);
  });
});

describe("kb_entries and kb_chunks", () => {
  afterEach(async () => {
    await db.delete(kbEntries);
  });

  it("defaults a new entry to pending with empty tags and no content", async () => {
    const [entry] = await db
      .insert(kbEntries)
      .values({ title: "Refund policy", sourceType: "article" })
      .returning();

    expect(entry.status).toBe("pending");
    expect(entry.tags).toEqual([]);
    expect(entry.content).toBeNull();
  });

  it("deletes chunks when their entry is deleted", async () => {
    const [entry] = await db
      .insert(kbEntries)
      .values({ title: "Cascade test", sourceType: "article", content: "body" })
      .returning();

    await db.insert(kbChunks).values({
      kbEntryId: entry.id,
      chunkIndex: 0,
      chunkText: "body",
      embedding: Array.from({ length: 1536 }, () => 0),
    });

    await db.delete(kbEntries).where(eq(kbEntries.id, entry.id));

    const remaining = await db.select().from(kbChunks).where(eq(kbChunks.kbEntryId, entry.id));
    expect(remaining).toHaveLength(0);
  });

  it("generates a search vector from the chunk text", async () => {
    const [entry] = await db
      .insert(kbEntries)
      .values({ title: "Search vector test", sourceType: "article", content: "body" })
      .returning();

    await db.insert(kbChunks).values({
      kbEntryId: entry.id,
      chunkIndex: 0,
      chunkText: "Refunds are issued within fourteen days",
      embedding: Array.from({ length: 1536 }, () => 0),
    });

    const result = await db.execute(sql`
      SELECT count(*)::int AS hits
      FROM kb_chunks
      WHERE search_vector @@ plainto_tsquery('english', 'refund')
    `);

    expect(result[0].hits).toBe(1);
  });
});
