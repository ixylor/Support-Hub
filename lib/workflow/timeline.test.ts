import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, kbChunks, kbEntries, llmLogs, ticketApprovals, tickets } from "@/lib/db/schema";
import { createTestTicket } from "@/lib/test-helpers/tickets";
import { getApprovalCitations, getRunTimeline } from "./timeline";

describe("workflow timeline", () => {
  let ticketId: string;
  let entryIds: string[] = [];

  beforeEach(async () => {
    ticketId = await createTestTicket({});
    entryIds = [];
  });

  afterEach(async () => {
    await db.delete(ticketApprovals).where(eq(ticketApprovals.ticketId, ticketId));
    await db.delete(llmLogs).where(eq(llmLogs.ticketId, ticketId));
    await db.delete(tickets).where(eq(tickets.id, ticketId));
    for (const entryId of entryIds) {
      await db.delete(kbChunks).where(eq(kbChunks.kbEntryId, entryId));
      await db.delete(kbEntries).where(eq(kbEntries.id, entryId));
    }
  });

  it("combines agent calls and approvals in chronological order", async () => {
    const [agent] = await db.select({ id: agents.id }).from(agents).limit(1);
    await db.insert(ticketApprovals).values({
      ticketId,
      graphThreadId: `timeline:${ticketId}`,
      kind: "send_email",
      proposal: { body: "Draft" },
      confidence: "0.8",
      createdAt: new Date("2026-09-21T10:00:00Z"),
    });
    await db.insert(llmLogs).values({
      ticketId,
      agentId: agent.id,
      graphThreadId: `timeline:${ticketId}`,
      prompt: "Prompt",
      response: '{"body":"Draft"}',
      model: "gpt-test",
      createdAt: new Date("2026-09-21T09:00:00Z"),
    });

    const entries = await getRunTimeline(ticketId);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: "agent",
      detail: 'gpt-test: {"body":"Draft"}',
    });
    expect(entries[1]).toMatchObject({
      kind: "approval",
      label: "send_email",
      detail: "Waiting for a reviewer",
    });
  });

  it("resolves cited chunk titles and ignores malformed ids", async () => {
    const [entry] = await db
      .insert(kbEntries)
      .values({ title: "Password reset", sourceType: "article", status: "ready" })
      .returning({ id: kbEntries.id });
    entryIds.push(entry.id);
    const [chunk] = await db
      .insert(kbChunks)
      .values({ kbEntryId: entry.id, chunkIndex: 0, chunkText: "Reset instructions" })
      .returning({ id: kbChunks.id });

    await expect(
      getApprovalCitations({ citedChunkIds: [chunk.id, "not-a-uuid"] })
    ).resolves.toEqual([{ chunkId: chunk.id, entryId: entry.id, title: "Password reset" }]);
    await expect(getApprovalCitations({ citedChunkIds: "not-an-array" })).resolves.toEqual([]);
  });
});
