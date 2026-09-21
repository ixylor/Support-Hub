import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { kbChunks, kbEntries } from "@/lib/db/schema";
import * as embeddings from "@/lib/ai/embeddings";
import { searchKnowledgeBase } from "./retrieve";

// Orthogonal unit vectors: a query matching one is maximally distant from the
// other, so vector ranking is unambiguous.
function axis(index: number): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  vector[index] = 1;
  return vector;
}

describe("searchKnowledgeBase", () => {
  let billingEntryId: string;
  let shippingEntryId: string;

  beforeEach(async () => {
    const [billing] = await db
      .insert(kbEntries)
      .values({
        title: "Billing policy",
        sourceType: "article",
        content: "x",
        status: "ready",
        tags: ["billing"],
      })
      .returning({ id: kbEntries.id });
    billingEntryId = billing.id;

    const [shipping] = await db
      .insert(kbEntries)
      .values({
        title: "Shipping policy",
        sourceType: "article",
        content: "x",
        status: "ready",
        tags: ["shipping"],
      })
      .returning({ id: kbEntries.id });
    shippingEntryId = shipping.id;

    await db.insert(kbChunks).values([
      {
        kbEntryId: billingEntryId,
        chunkIndex: 0,
        chunkText: "Refunds are issued within fourteen days. Error ERR_4032 means the card expired.",
        embedding: axis(0),
      },
      {
        kbEntryId: shippingEntryId,
        chunkIndex: 0,
        chunkText: "Parcels are dispatched on weekdays and delivered within a week.",
        embedding: axis(1),
      },
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(kbEntries);
  });

  function mockQueryVector(vector: number[]): void {
    vi.spyOn(embeddings, "embedTexts").mockResolvedValue({
      embeddings: [vector],
      modelName: "text-embedding-3-small",
    });
  }

  it("returns nothing for an empty query without calling the embedder", async () => {
    const spy = vi.spyOn(embeddings, "embedTexts");

    expect(await searchKnowledgeBase({ query: "   " })).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("finds a semantically close chunk through the vector arm", async () => {
    mockQueryVector(axis(1));

    const [top] = await searchKnowledgeBase({ query: "when do parcels go out" });

    expect(top.entryId).toBe(shippingEntryId);
  });

  it("finds an exact token through the text arm even when the vector points elsewhere", async () => {
    // The query vector matches the shipping chunk, but the literal token only
    // appears in the billing chunk. This is the case pure vector search fails.
    mockQueryVector(axis(1));

    const results = await searchKnowledgeBase({ query: "ERR_4032" });

    expect(results.some((r) => r.entryId === billingEntryId)).toBe(true);
  });

  it("filters to the requested tags", async () => {
    mockQueryVector(axis(0));

    const results = await searchKnowledgeBase({ query: "refunds", tags: ["shipping"] });

    expect(results.every((r) => r.entryId === shippingEntryId)).toBe(true);
  });

  it("excludes entries that are not ready", async () => {
    await db.update(kbEntries).set({ status: "failed" });
    mockQueryVector(axis(0));

    expect(await searchKnowledgeBase({ query: "refunds" })).toEqual([]);
  });

  it("honours the limit", async () => {
    mockQueryVector(axis(0));

    expect(await searchKnowledgeBase({ query: "policy", limit: 1 })).toHaveLength(1);
  });

  it("returns the entry title and tags alongside each chunk", async () => {
    mockQueryVector(axis(0));

    const [top] = await searchKnowledgeBase({ query: "refunds" });

    expect(top.title).toBe("Billing policy");
    expect(top.tags).toEqual(["billing"]);
    expect(top.score).toBeGreaterThan(0);
  });

  it("returns results in descending score order", async () => {
    mockQueryVector(axis(0));

    const results = await searchKnowledgeBase({ query: "refunds parcels" });
    const scores = results.map((r) => r.score);

    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("returns nothing when the tag filter matches no entry", async () => {
    mockQueryVector(axis(0));

    expect(await searchKnowledgeBase({ query: "refunds", tags: ["nonexistent"] })).toEqual([]);
  });

  it("normalizes an unnormalized tag filter before matching", async () => {
    mockQueryVector(axis(0));

    const results = await searchKnowledgeBase({ query: "refunds", tags: [" Billing "] });

    expect(results.some((r) => r.entryId === billingEntryId)).toBe(true);
  });
});
