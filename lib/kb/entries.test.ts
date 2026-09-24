import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiDeployments, appSecrets, kbChunks, kbEntries } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import { activateDeployment, setAzureCredentials } from "@/lib/ai/config";
import {
  createArticleEntry,
  deleteEntry,
  knowledgeBaseReadiness,
  listEntries,
  listTags,
} from "./entries";

vi.mock("@/lib/jobs/boss", () => ({
  QUEUES: { kbProcess: "kb.process", mailboxPoll: "mailbox.poll" },
  enqueue: vi.fn(async () => {}),
}));

describe("knowledge base entries", () => {
  let adminId: string;
  beforeEach(async () => {
    const [row] = await db
      .insert(user)
      .values({
        id: `entries-test-${crypto.randomUUID()}`,
        name: "Entries Admin",
        email: `entries-test-${crypto.randomUUID()}@example.com`,
        role: "admin",
      })
      .returning({ id: user.id });
    adminId = row.id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.delete(kbEntries);
    await db.delete(aiDeployments);
    await db.delete(appSecrets);
  });

  async function configureProvider(): Promise<void> {
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
  }

  it("reports not ready when credentials are missing", async () => {
    const readiness = await knowledgeBaseReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toMatch(/credentials/i);
  });

  it("reports not ready when no embedding deployment is active", async () => {
    await setAzureCredentials(
      { endpoint: "https://example.openai.azure.com", apiKey: "k", apiVersion: "2024-10-21" },
      adminId
    );

    const readiness = await knowledgeBaseReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toMatch(/embedding deployment/i);
  });

  it("reports ready once both are configured", async () => {
    await configureProvider();

    expect(await knowledgeBaseReadiness()).toEqual({ ready: true });
  });

  it("creates an article entry with its body as content", async () => {
    const id = await createArticleEntry({
      title: "Shipping",
      tags: ["shipping"],
      body: "We ship on weekdays.",
      uploadedByUserId: adminId,
    });

    const [entry] = await db.select().from(kbEntries).where(eq(kbEntries.id, id));
    expect(entry.sourceType).toBe("article");
    expect(entry.content).toBe("We ship on weekdays.");
  });

  it("rejects an empty title", async () => {
    await expect(
      createArticleEntry({ title: "  ", tags: [], body: "x", uploadedByUserId: adminId })
    ).rejects.toThrow(/title/i);
  });

  it("normalizes tags to lowercase, trimmed and unique", async () => {
    const id = await createArticleEntry({
      title: "Tags",
      tags: [" Billing ", "billing", "REFUNDS", ""],
      body: "x",
      uploadedByUserId: adminId,
    });

    const [entry] = await db.select().from(kbEntries).where(eq(kbEntries.id, id));
    expect(entry.tags).toEqual(["billing", "refunds"]);
  });

  it("lists entries with their chunk counts", async () => {
    const id = await createArticleEntry({
      title: "Counted",
      tags: [],
      body: "x",
      uploadedByUserId: adminId,
    });
    await db.insert(kbChunks).values([
      { kbEntryId: id, chunkIndex: 0, chunkText: "a", embedding: Array(1536).fill(0) },
      { kbEntryId: id, chunkIndex: 1, chunkText: "b", embedding: Array(1536).fill(0) },
    ]);

    const [summary] = await listEntries();
    expect(summary.chunkCount).toBe(2);
  });

  it("lists an entry with no chunks as zero rather than omitting it", async () => {
    await createArticleEntry({ title: "Empty", tags: [], body: "x", uploadedByUserId: adminId });

    const [summary] = await listEntries();
    expect(summary.chunkCount).toBe(0);
  });

  it("returns the distinct set of tags in use", async () => {
    await createArticleEntry({ title: "A", tags: ["billing"], body: "x", uploadedByUserId: adminId });
    await createArticleEntry({
      title: "B",
      tags: ["billing", "shipping"],
      body: "x",
      uploadedByUserId: adminId,
    });

    expect(await listTags()).toEqual(["billing", "shipping"]);
  });

  it("deletes an entry and its chunks", async () => {
    const id = await createArticleEntry({
      title: "Doomed",
      tags: [],
      body: "x",
      uploadedByUserId: adminId,
    });
    await db.insert(kbChunks).values({
      kbEntryId: id,
      chunkIndex: 0,
      chunkText: "a",
      embedding: Array(1536).fill(0),
    });

    await deleteEntry(id);

    expect(await db.select().from(kbEntries).where(eq(kbEntries.id, id))).toHaveLength(0);
    expect(await db.select().from(kbChunks).where(eq(kbChunks.kbEntryId, id))).toHaveLength(0);
  });

  it("deletes a text article", async () => {
    const id = await createArticleEntry({
      title: "Article",
      tags: [],
      body: "x",
      uploadedByUserId: adminId,
    });

    await expect(deleteEntry(id)).resolves.toBeUndefined();
  });
});
