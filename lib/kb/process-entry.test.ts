import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiDeployments, appSecrets, kbChunks, kbEntries } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import { activateDeployment, setAzureCredentials } from "@/lib/ai/config";
import { RetryableAiError } from "@/lib/ai/errors";
import * as embeddings from "@/lib/ai/embeddings";
import { processKbEntry } from "./process-entry";

function vectorOf(seed: number): number[] {
  return Array.from({ length: 1536 }, () => seed);
}

describe("processKbEntry", () => {
  let adminId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(user)
      .values({
        id: `process-test-${crypto.randomUUID()}`,
        name: "Process Admin",
        email: `process-test-${crypto.randomUUID()}@example.com`,
        role: "admin",
      })
      .returning({ id: user.id });
    adminId = row.id;

    await setAzureCredentials(
      { endpoint: "https://example.openai.azure.com", apiKey: "k", apiVersion: "2024-10-21" },
      adminId
    );
    await activateDeployment(
      {
        role: "embedding",
        deploymentName: "embed",
        modelName: "text-embedding-3-small",
        dimensions: 1536,
      },
      adminId
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(kbEntries);
    await db.delete(aiDeployments);
    await db.delete(appSecrets);
  });

  async function createArticle(content: string): Promise<string> {
    const [entry] = await db
      .insert(kbEntries)
      .values({ title: "Refund policy", sourceType: "article", content, uploadedByUserId: adminId })
      .returning({ id: kbEntries.id });
    return entry.id;
  }

  function mockEmbeddings(): void {
    vi.spyOn(embeddings, "embedTexts").mockImplementation(async (texts) => ({
      embeddings: texts.map((_, i) => vectorOf(i)),
      modelName: "text-embedding-3-small",
    }));
  }

  it("marks an article ready and stores its chunks", async () => {
    mockEmbeddings();
    const entryId = await createArticle("Refunds are issued within fourteen days.");

    await processKbEntry(entryId);

    const [entry] = await db.select().from(kbEntries).where(eq(kbEntries.id, entryId));
    expect(entry.status).toBe("ready");
    expect(entry.errorMessage).toBeNull();
    expect(entry.embeddingModel).toBe("text-embedding-3-small");
    expect(entry.contentHash).toHaveLength(64);

    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.kbEntryId, entryId));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toContain("fourteen days");
  });

  it("numbers chunks from zero in order", async () => {
    mockEmbeddings();
    const entryId = await createArticle("Sentence about refunds. ".repeat(300));

    await processKbEntry(entryId);

    const chunks = await db
      .select()
      .from(kbChunks)
      .where(eq(kbChunks.kbEntryId, entryId))
      .orderBy(kbChunks.chunkIndex);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("replaces existing chunks when reprocessed", async () => {
    mockEmbeddings();
    const entryId = await createArticle("First version of the policy.");
    await processKbEntry(entryId);

    await db
      .update(kbEntries)
      .set({ content: "Second version of the policy.", status: "pending" })
      .where(eq(kbEntries.id, entryId));
    await processKbEntry(entryId);

    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.kbEntryId, entryId));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toContain("Second version");
  });

  it("fails the entry when extraction yields no text", async () => {
    mockEmbeddings();
    const entryId = await createArticle("   ");

    await processKbEntry(entryId);

    const [entry] = await db.select().from(kbEntries).where(eq(kbEntries.id, entryId));
    expect(entry.status).toBe("failed");
    expect(entry.errorMessage).toMatch(/no readable text/i);
  });

  it("rethrows a retryable error and leaves the entry processing", async () => {
    vi.spyOn(embeddings, "embedTexts").mockRejectedValue(new RetryableAiError("429"));
    const entryId = await createArticle("Refunds are issued within fourteen days.");

    await expect(processKbEntry(entryId)).rejects.toThrow(RetryableAiError);

    const [entry] = await db.select().from(kbEntries).where(eq(kbEntries.id, entryId));
    expect(entry.status).toBe("processing");
  });

  it("leaves previous chunks intact when reprocessing fails", async () => {
    mockEmbeddings();
    const entryId = await createArticle("First version of the policy.");
    await processKbEntry(entryId);

    vi.spyOn(embeddings, "embedTexts").mockRejectedValue(new RetryableAiError("429"));
    await db
      .update(kbEntries)
      .set({ content: "Second version.", status: "pending" })
      .where(eq(kbEntries.id, entryId));
    await expect(processKbEntry(entryId)).rejects.toThrow(RetryableAiError);

    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.kbEntryId, entryId));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toContain("First version");
  });

  it("records a permanent failure on the entry without throwing", async () => {
    mockEmbeddings();
    const [entry] = await db
      .insert(kbEntries)
      .values({
        title: "Missing file",
        sourceType: "pdf",
        storagePath: "./storage/kb/does-not-exist/missing.pdf",
        contentType: "application/pdf",
        uploadedByUserId: adminId,
      })
      .returning({ id: kbEntries.id });

    await processKbEntry(entry.id);

    const [row] = await db.select().from(kbEntries).where(eq(kbEntries.id, entry.id));
    expect(row.status).toBe("failed");
    expect(row.errorMessage).not.toBeNull();
  });

  it("does nothing for an entry id that does not exist", async () => {
    await expect(processKbEntry(crypto.randomUUID())).resolves.toBeUndefined();
  });
});
